const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");
const http = require("http");
const { resolvePromptBuildList } = require("../public/shared-build-history");
const PromptEngine = require("../prompt-engine");
const { httpStatusForError } = require("../http-errors");
const RELEASE_VERSION = require("../package.json").version;

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-smoke-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const PROJECT_DIR = path.join(PROJECTS_ROOT, "smoke-project");
let PORT = 0;
let OLLAMA_PORT = 0;
let ollamaServer = null;
const ollamaChatBodies = [];

fs.mkdirSync(PROJECT_DIR, { recursive: true });
for (const dir of ["anchors", "plates", "props", "audio", "media", "shots", "docs"]) {
  fs.mkdirSync(path.join(PROJECT_DIR, dir), { recursive: true });
}
fs.writeFileSync(
  path.join(PROJECT_DIR, "project.json"),
  JSON.stringify(
    {
      meta: {
        title: "Smoke Project",
        format: "Test",
        version: "v1",
        hubVersion: "v5.5.0",
        aiPolicy: "project-default",
      },
      qcChecklist: [],
      characters: [],
      locations: [],
      props: [],
      audio: [],
      mediaAssets: [],
      scenes: [{ id: "SC-01", title: "Scene One" }],
      shots: [
        {
          id: "S-01",
          scene: "SC-01",
          title: "Test shot",
          desc: "A fixed exterior camera watches a ship in darkness.",
          positioning: "Locked hull-camera composition.",
          dur: 10,
          workflowStatus: "DRAFT",
          keyframes: [
            {
              id: "frame-a",
              label: "A",
              title: "Opening frame",
              winner: "approved-start.png",
              generationPackages: [],
            },
          ],
          clips: [
            {
              id: "seg-a",
              suffix: "a",
              label: "A",
              title: "Primary motion",
              dur: 10,
              kind: "i2v",
              fromFrame: "frame-a",
              motionPrompt:
                "The ship hangs in the dark; the slowest drift and rotation; a running light blinks. Camera remains locked. No other motion.",
              generationPackages: [],
            },
          ],
        },
      ],
      jobs: [],
      agentRuns: [],
      decisions: [],
      sessions: [],
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify(
    {
      activeProject: "smoke-project",
      assistant: { provider: "none", visionProvider: "none" },
      ollamaUrl: "http://127.0.0.1:__OLLAMA_PORT__",
      ollamaModel: "qwen3.6:35b-a3b",
      ollamaVisionModel: "qwen3-vl:30b-a3b-instruct",
      ollamaEmbedModel: "qwen3-embedding:4b",
      agents: { enabled: true, maxConcurrent: 1 },
      execution: {
        fal: { apiKey: "legacy-fal-key" },
      },
    },
    null,
    2,
  ),
);

let child = null;
let output = "";
let base = "";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function startMockOllama() {
  return new Promise((resolve) => {
    ollamaServer = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.method === "GET" && req.url === "/api/tags") {
        res.end(
          JSON.stringify({
            models: [
              { name: "qwen3.6:35b-a3b" },
              { name: "qwen3-vl:30b-a3b-instruct" },
              { name: "qwen3-embedding:4b" },
              { name: "qwen3-coder:30b" },
            ],
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/api/embed") {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          const body = JSON.parse(raw || "{}");
          const count = Array.isArray(body.input) ? body.input.length : 1;
          setTimeout(
            () =>
              res.end(
                JSON.stringify({
                  embeddings: Array.from({ length: count }, (_, i) => [1, i / 10, 0]),
                }),
              ),
            250,
          );
        });
        return;
      }
      if (req.method === "POST" && req.url === "/api/generate") {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          const body = JSON.parse(raw || "{}");
          const response = body.model === "fallback-response-test" ? "CineBraid assistant connected" : "";
          res.end(JSON.stringify({ response }));
        });
        return;
      }
      if (req.method === "POST" && req.url === "/api/chat") {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          const body = JSON.parse(raw || "{}");
          ollamaChatBodies.push(body);
          const system = String(body.messages?.[0]?.content || "");
          const user = String(body.messages?.[1]?.content || "");
          if (raw.includes("FORCE_TIMEOUT_TEST")) return;
          let content = JSON.stringify({ summary: "Mock planner response." });
          if (["empty-response-test", "fallback-response-test"].includes(body.model)) {
            content = "";
          } else if (system.includes("Reply with exactly: CineBraid assistant connected")) {
            content = "CineBraid assistant connected";
          } else if (system.includes("blocking-plan editor")) {
            content = JSON.stringify({
              emphasis: "action-insert",
              camera: { shotSize: "close-up", height: "ground-level", angle: "level", lens: "normal", view: "front", layout: "centered", crop: "detail" },
              environmentEmphasis: "minimal",
              primaryAction: "Rear truck wheel rolls backward onto the skull.",
              layoutLines: ["Rear truck wheel dominates the foreground.", "The skull sits directly beneath the tire at the contact point."],
              conflictsResolved: ["Replaced wide framing with a tight action insert."]
            });
          } else if (system.includes("production-reference reviewer")) {
            const authorityReview = {
              score: 88,
              pass: true,
              hardChecks: {
                sameUnderlyingEntity: { pass: true, note: "The same canonical asset is preserved." },
                onlyRequestedDelta: { pass: true, note: "Only the requested continuity delta changes." },
                sameEmbeddedContent: { pass: true, note: "Embedded content is unchanged." },
                sameSpatialGeometry: { pass: true, note: "The same physical geometry is preserved." },
                requestedViewCorrect: { pass: true, note: "The requested view is clear." },
              },
              categories: {
                design: { severity: "pass", note: "The approved design is preserved." },
                state: { severity: "minor", note: "The requested state is readable." },
                requirements: { severity: "pass", note: "Required details are readable." },
                usefulness: { severity: "pass", note: "Clear production authority." },
                cleanliness: { severity: "pass", note: "No visible artifacts or accidental text." },
              },
              referenceNotes: [],
              summary: "Strong continuity candidate.",
              recommendation: "approve",
            };
            if (user.includes("FORCE_MAJOR_PASS")) {
              authorityReview.score = 96;
              authorityReview.categories.design = { severity: "major", note: "The model changed a major design feature." };
              authorityReview.summary = "Attractive but materially redesigned.";
            }
            /* The stub obeys the contract it is handed. In ESTABLISH mode a
               real reviewer has no authority to compare against, so it returns
               no comparison verdicts at all — which is exactly the shape the
               route must stop treating as a failure. */
            if (user.includes("AUTHORITY MODE: ESTABLISH_AUTHORITY")) {
              authorityReview.hardChecks = {};
              authorityReview.categories.state = { severity: "pass", note: "The requested state reads correctly." };
              authorityReview.score = 82;
              authorityReview.pass = false;
              authorityReview.summary = "Strong visual match; no approved authority exists to compare against yet.";
              authorityReview.recommendation = "approve";
            }
            if (user.includes("FORCE_STATE_MISMATCH")) {
              authorityReview.stateMatch = { matchesRequestedState: false, closerState: "Damp inside", note: "The candidate depicts the related interior state." };
              authorityReview.score = 82;
            }
            if (user.includes("FORCE_EMBEDDED_MISMATCH")) {
              authorityReview.score = 94;
              authorityReview.hardChecks.sameEmbeddedContent = { pass: false, note: "The photograph inside the prop was replaced with a different image." };
              authorityReview.summary = "The outer prop matches, but its embedded photograph changed.";
            }
            content = JSON.stringify(authorityReview);
          } else if (system.includes("approved still frames that will be used")) {
            content = JSON.stringify({
              pass: true,
              score: 86,
              summary: "The frame pair has a major background-light continuity break.",
              categories: {
                camera: { score: 92, note: "Camera position is stable." },
                environment: { score: 72, note: "Background set dressing shifts." },
                lighting: { score: 44, note: "A practical light appears in the second frame." },
                character: { score: 91, note: "Character identity is stable." },
                props: { score: 88, note: "The main prop remains recognizable." },
                intendedProgression: { score: 90, note: "The intended docking action reads." }
              },
              blockingIssues: ["A background practical light appears only in Frame B."],
              warnings: [],
              nextAction: "Regenerate Frame B from Frame A while locking all background lights and set geometry."
            });
          } else if (system.includes("dependent still frames")) {
            content = user.includes("OMIT_PASS_TEST")
              ? JSON.stringify({ reviews: [{ n: 1, score: 99, notes: "The model omitted the required pass field." }, { n: 2, pass: false, score: 40, notes: "Visible drift." }], ranking: [1, 2], suggested: 1, rationale: "Malformed pass/fail output test." })
              : user.includes("OMIT_SCORE_TEST")
                ? JSON.stringify({ reviews: [{ n: 1, pass: true, notes: "The model omitted the required score." }, { n: 2, pass: false, score: 40, notes: "Visible drift." }], ranking: [1, 2], suggested: 1, rationale: "Malformed score output test." })
                : JSON.stringify({ reviews: [{ n: 1, pass: true, score: 92, notes: "Best preserves the parent frame." }, { n: 2, pass: false, score: 61, notes: "Visible drift." }], ranking: [1, 2], suggested: 1, rationale: "Candidate 1 is strongest." });
          } else if (system.includes("motion-direction editor")) {
            let original = user;
            try { original = JSON.parse(user).original || user; } catch {}
            if (original.includes("NESTED_JSON_TEST")) {
              content = JSON.stringify({
                directive: JSON.stringify({
                  directive: "The ship drifts and rotates almost imperceptibly while one running light blinks steadily. The hull camera remains locked. Audio: a low mechanical chirp follows every blink.",
                  changes: ["Made the subject and camera behavior explicit."],
                }),
                changes: ["Returned an accidentally nested object."],
              });
            } else if (original.includes("LABELLED_TEXT_TEST")) {
              content = "DIRECTIVE:\nThe ship drifts almost imperceptibly while the running light blinks once. Camera remains locked.\nCHANGES:\n- Reduced the action to observable motion.\n- Kept the camera fixed.";
            } else if (original.includes("UNUSABLE_MOTION_TEST")) {
              content = JSON.stringify({ changes: ["No usable directive was returned."] });
            } else {
              content = JSON.stringify({ directive: "The ship drifts almost imperceptibly while one running light blinks. Camera remains locked.", changes: ["Clarified the visible movement."] });
            }
          } else if (system.includes("scoped Shot Guide")) {
            content = JSON.stringify({
              summary: "Prepared a clearer shot-plan field.",
              draft: { desc: "", positioning: "Locked exterior hull-camera composition; the ship remains centered while the running light crosses the upper third.", characters: [], codes: [], frames: [], motion: [] },
              notes: [],
            });
          } else {
            content = JSON.stringify({
              frames: [{
                n: 1,
                role: "composition",
                subjects: [{ identity: "A maintenance worker beside a hull panel", screenPosition: "left third", orientation: "profile to panel", pose: "standing with one arm raised", gaze: "toward the controls", hands: "one hand near the panel" }],
                camera: { shotSize: "wide", height: "eye level", angle: "locked side view", lensIntent: "preserve panel and worker silhouette" },
                environment: { summary: "Dark exterior maintenance bay", importantGeometry: ["panel on frame right"] },
                continuityRisks: ["Keep worker on the same screen side"],
              }],
              camera: { summary: "Locked wide composition" },
              transition: { requiredChanges: [], invariants: [], conflicts: [] },
              globalRisks: [],
            });
          }
          res.end(JSON.stringify({ message: { content } }));
        });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          const body = JSON.parse(raw || "{}"),
            system = String(body.messages?.[0]?.content || ""),
            user = String(body.messages?.[1]?.content || "");
          if (raw.includes("FORCE_TIMEOUT_TEST")) return;
          let content = JSON.stringify({ summary: "Mock planner response." });
          if (system.includes("blocking-plan editor")) {
            content = JSON.stringify({
              emphasis: "action-insert",
              camera: { shotSize: "close-up", height: "ground-level", angle: "level", lens: "normal", view: "front", layout: "centered", crop: "detail" },
              environmentEmphasis: "minimal",
              primaryAction: "Rear truck wheel rolls backward onto the skull.",
              layoutLines: ["Rear truck wheel dominates the foreground.", "The skull sits directly beneath the tire at the contact point."],
              conflictsResolved: ["Replaced wide framing with a tight action insert."]
            });
          } else if (system.includes("approved still frames that will be used")) {
            content = JSON.stringify({
              pass: true,
              score: 86,
              summary: "The frame pair has a major background-light continuity break.",
              categories: {
                camera: { score: 92, note: "Camera position is stable." },
                environment: { score: 72, note: "Background set dressing shifts." },
                lighting: { score: 44, note: "A practical light appears in the second frame." },
                character: { score: 91, note: "Character identity is stable." },
                props: { score: 88, note: "The main prop remains recognizable." },
                intendedProgression: { score: 90, note: "The intended docking action reads." }
              },
              blockingIssues: ["A background practical light appears only in Frame B."],
              warnings: [],
              nextAction: "Regenerate Frame B from Frame A while locking all background lights and set geometry."
            });
          } else if (system.includes("dependent still frames")) {
            content = user.includes("OMIT_PASS_TEST")
              ? JSON.stringify({ reviews: [{ n: 1, score: 99, notes: "The model omitted the required pass field." }, { n: 2, pass: false, score: 40, notes: "Visible drift." }], ranking: [1, 2], suggested: 1, rationale: "Malformed pass/fail output test." })
              : user.includes("OMIT_SCORE_TEST")
                ? JSON.stringify({ reviews: [{ n: 1, pass: true, notes: "The model omitted the required score." }, { n: 2, pass: false, score: 40, notes: "Visible drift." }], ranking: [1, 2], suggested: 1, rationale: "Malformed score output test." })
                : JSON.stringify({
                  reviews: [
                    { n: 1, pass: true, score: 92, notes: "Best preserves the approved parent frame while completing the endpoint action." },
                    { n: 2, pass: false, score: 61, notes: "Camera and identity drift from the parent frame." },
                  ],
                  ranking: [1, 2],
                  suggested: 1,
                  rationale: "Candidate 1 is the cleaner first/last-frame endpoint.",
                });
          } else if (system.includes("visual staging")) {
            content = JSON.stringify({
              mode: "suggest",
              summary: "Stage the tire and skull as a tight ground-level insert.",
              camera: { shotSize: "close-up", height: "ground-level", angle: "level", lens: "normal", view: "front", layout: "centered", crop: "detail" },
              environmentBaseKey: "location:gates",
              elements: [
                { referenceKey: "prop:truck", x: .42, y: .5, w: .7, h: .78, depth: "foreground", facing: "camera", view: "three-quarter-left", crop: "partial-left", notes: "Dominant tire." },
                { referenceKey: "prop:skull", x: .58, y: .75, w: .3, h: .25, depth: "foreground", facing: "camera", view: "reference-view", crop: "none", notes: "At the contact point." }
              ],
              issues: ["The original wide framing conflicts with the tight insert."],
              rationale: ["The physical contact is the story beat."],
              replaceLayout: true
            });
          } else           if (system.includes("motion-direction editor")) {
            let original = user;
            try { original = JSON.parse(user).original || user; } catch {}
            if (original.includes("NESTED_JSON_TEST")) {
              content = JSON.stringify({
                directive: JSON.stringify({
                  directive: "The ship drifts and rotates almost imperceptibly while one running light blinks steadily. The hull camera remains locked. Audio: a low mechanical chirp follows every blink.",
                  changes: ["Made the subject and camera behavior explicit."],
                }),
                changes: ["Returned an accidentally nested object."],
              });
            } else if (original.includes("LABELLED_TEXT_TEST")) {
              content = "DIRECTIVE:\nThe ship drifts almost imperceptibly while the running light blinks once. Camera remains locked.\nCHANGES:\n- Reduced the action to observable motion.\n- Kept the camera fixed.";
            } else if (original.includes("UNUSABLE_MOTION_TEST")) {
              content = JSON.stringify({ changes: ["No usable directive was returned."] });
            } else {
              content = JSON.stringify({
                directive: "The ship drifts almost imperceptibly while one running light blinks. Camera remains locked.",
                changes: ["Clarified the visible movement."],
              });
            }
          }
          if (system.includes("scoped Shot Guide"))
            content = JSON.stringify({
              summary: "Prepared a clearer shot-plan field.",
              draft: {
                desc: "",
                positioning:
                  "Locked exterior hull-camera composition; the ship remains centered while the running light crosses the upper third.",
                characters: [],
                codes: [],
                frames: [],
                motion: [],
              },
              notes: [],
            });
          res.end(
            JSON.stringify({
              choices: [{ message: { content } }],
            }),
          );
        });
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "mock route not found" }));
    });
    ollamaServer.listen(0, "127.0.0.1", () => {
      OLLAMA_PORT = ollamaServer.address().port;
      resolve();
    });
  });
}

function startServer() {
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      CINEBRAID_CONFIG_PATH: CONFIG_PATH,
      CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
      CINEBRAID_AI_TEXT_TIMEOUT_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
}

async function request(url, options) {
  const response = await fetch(base + url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text();
  return { response, body };
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const result = await fetch(base + "/api/me");
      if (result.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Server did not start. Output:\n${output}`);
}

async function waitForAgent(id, statuses, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await request("/api/agents/status");
    const run = result.body.runs.find((x) => x.id === id);
    if (run && statuses.includes(run.status)) return { run, status: result.body };
    if (run && ["FAILED", "CANCELLED"].includes(run.status))
      throw new Error(`Agent ${id} ended ${run.status}: ${run.error || run.message}`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Agent ${id} did not reach ${statuses.join("/")}`);
}

async function main() {
  try {
    await startMockOllama();
    const config = fs
      .readFileSync(CONFIG_PATH, "utf8")
      .replace("__OLLAMA_PORT__", String(OLLAMA_PORT));
    fs.writeFileSync(CONFIG_PATH, config);
    PORT = await getFreePort();
    base = `http://127.0.0.1:${PORT}`;
    startServer();
    await waitForServer();

    let result = await request("/api/project");
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.meta.title, "Smoke Project");
    assert.strictEqual(
      result.response.headers.get("x-cinebraid-project-slug"),
      "smoke-project",
    );

    assert.strictEqual(httpStatusForError(new Error("genuine internal fault")), 500, "untagged internal faults must remain 500 errors");
    result = await request("/api/prompt/compile", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shotId: "NOPE", profileId: "gpt-image-2/t2i", purpose: "first-frame", useLLM: false }),
    });
    assert.strictEqual(result.response.status, 404, "an unknown shot is a permanent not-found error, not a retryable server fault");
    assert.match(result.body.error, /Shot not found/i);
    result = await request("/api/composer/assist", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shotId: "NOPE", mode: "suggest", useLLM: false, references: [] }),
    });
    assert.strictEqual(result.response.status, 404, "all buildContext callers must preserve unknown-shot semantics");
    result = await request("/api/prompt/compile", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shotId: "S-01", profileId: "no/such", purpose: "first-frame", useLLM: false }),
    });
    assert.strictEqual(result.response.status, 400);
    result = await request("/api/prompt/compile", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shotId: "S-01", profileId: "gpt-image-2/t2i", purpose: "../../etc/passwd", useLLM: false }),
    });
    assert.strictEqual(result.response.status, 400);
    assert.match(result.body.error, /Accepted values:.*first-frame.*motion/i);
    for (const purpose of PromptEngine.SUPPORTED_PROMPT_PURPOSES) {
      const profileId = purpose === "motion" ? "seedance-2/r2v" : purpose === "blocking" ? "gpt-image-2/blocking" : purpose === "edit" || purpose === "continuity-fix" ? "gpt-image-2/edit" : "gpt-image-2/t2i";
      const accepted = await request("/api/prompt/compile", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ shotId: "S-01", segmentId: purpose === "motion" ? "seg-a" : "", profileId, purpose, directive: "Camera remains locked.", references: [], useLLM: false }),
      });
      assert.strictEqual(accepted.response.status, 200, `implemented prompt purpose ${purpose} must be accepted`);
    }
    result = await request("/api/project/readiness");
    assert.strictEqual(result.response.status, 200);
    assert(Array.isArray(result.body.issues), "project readiness must return a read-only issue list");
    const readinessProjectSource = fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8");
    const readinessProject = JSON.parse(readinessProjectSource);
    readinessProject.shots[0].characters = ["MISSING-CHAR"];
    readinessProject.shots[0].creationBrief = { locationId: "MISSING-LOC", propIds: ["MISSING-PROP"] };
    fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(readinessProject, null, 2));
    result = await request("/api/project/readiness");
    assert.strictEqual(result.response.status, 200);
    for (const id of ["MISSING-CHAR", "MISSING-LOC", "MISSING-PROP"]) {
      const issue = result.body.issues.find((row) => row.kind === "unresolved-reference" && String(row.message || "").includes(id));
      assert(issue, `project readiness must expose unresolved relationship ${id}`);
      assert.strictEqual(issue.href, "#/shot/S-01", "unresolved relationship must link back to its shot Inputs workspace");
    }
    fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), readinessProjectSource);
    const validProjectSource = fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8");
    fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), "{ malformed project json");
    result = await request("/api/prompt/compile", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shotId: "S-01", profileId: "gpt-image-2/t2i", purpose: "first-frame", useLLM: false }),
    });
    assert.strictEqual(result.response.status, 500, "genuine internal project-read faults must remain 500 errors");
    fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), validProjectSource);

    result = await request("/api/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(result.body),
    });
    assert.strictEqual(result.response.status, 409);
    assert.match(result.body.error, /project slug/i);

    const secondDir = path.join(PROJECTS_ROOT, "second-project");
    fs.mkdirSync(secondDir, { recursive: true });
    for (const dir of ["anchors", "plates", "props", "audio", "media", "shots", "docs"])
      fs.mkdirSync(path.join(secondDir, dir), { recursive: true });
    const secondProject = JSON.parse(
      fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"),
    );
    secondProject.meta.title = "Second Project";
    fs.writeFileSync(
      path.join(secondDir, "project.json"),
      JSON.stringify(secondProject, null, 2),
    );
    result = await request("/api/projects/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "second-project" }),
    });
    assert.strictEqual(result.response.status, 200);
    const firstProject = JSON.parse(
      fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"),
    );
    firstProject.meta.title = "Smoke Project Scoped Save";
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(firstProject),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/project");
    assert.strictEqual(result.body.meta.title, "Second Project");
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8")).meta.title,
      "Smoke Project Scoped Save",
    );
    assert(fs.existsSync(path.join(PROJECT_DIR, "project.json.bak")));
    assert(
      !fs.readdirSync(PROJECT_DIR).some((name) => name.endsWith(".tmp")),
      "atomic save must not leave temporary files",
    );
    result = await request("/api/projects/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "smoke-project" }),
    });
    assert.strictEqual(result.response.status, 200);

    result = await request("/api/automation/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "automation-smoke-1",
        type: "shot-chain",
        targetId: "S-01",
        scope: "stills",
        label: "Smoke durable run",
        mode: "required-frames",
        status: "running",
        stage: "Frame A prompt",
        config: { frameIds: ["frame-a"], maxImages: 15 },
        result: { sceneReview: { verdict: "needs_corrections" }, correctionPackages: [{ id: "pkg-1", targetShotId: "S-01" }] },
        usage: { imageRequests: 1, imagesGenerated: 3, assistantCalls: 2, reviewCalls: 1 },
        steps: {
          "frame:frame-a:round-1:generate": {
            key: "frame:frame-a:round-1:generate",
            kind: "generation",
            status: "completed",
            childJobId: "fal-child-1",
            files: ["FRAME_A_1.png", "FRAME_A_2.png", "FRAME_A_3.png"],
          },
        },
        logs: [{ at: new Date().toISOString(), tone: "success", message: "Generation returned." }],
      }),
    });
    assert.strictEqual(result.response.status, 201);
    assert.strictEqual(result.body.run.id, "automation-smoke-1");
    assert.strictEqual(result.body.run.steps["frame:frame-a:round-1:generate"].childJobId, "fal-child-1");
    assert.strictEqual(result.body.run.result.sceneReview.verdict, "needs_corrections", "scene-level run results must persist");
    assert.strictEqual(result.body.run.result.correctionPackages[0].targetShotId, "S-01");
    assert(fs.existsSync(path.join(PROJECT_DIR, "automation-runs.json")), "automation runs must persist inside the active project");

    const createdRunRevision = result.body.run.revision;
    result = await request("/api/automation/runs/automation-smoke-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: createdRunRevision, stage: "Frame A review", summary: "Ready to resume review." }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.run.stage, "Frame A review");
    assert.strictEqual(result.body.run.steps["frame:frame-a:round-1:generate"].status, "completed", "run updates must preserve completed durable steps");
    assert.strictEqual(result.body.run.result.correctionPackages[0].id, "pkg-1", "run updates must preserve scene correction packages");
    const reviewRunRevision = result.body.run.revision;
    const reviewUpdatedAt = result.body.run.updatedAt;

    result = await request("/api/automation/runs/automation-smoke-1/lease", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runnerId: "smoke-runner-a" }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.run.runnerId, "smoke-runner-a");
    assert(Number(result.body.leaseMs) >= 5 * 60_000, "automation leases must survive ordinary background-tab timer throttling");
    assert(Number(result.body.heartbeatMs) >= 60_000, "lease heartbeat cadence should be background-tab tolerant");
    result = await request("/api/automation/runs/automation-smoke-1/lease", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runnerId: "smoke-runner-b" }),
    });
    assert.strictEqual(result.response.status, 409, "a second window must not acquire an active run lease");
    assert.strictEqual(result.body.code, "RUN_LEASED");
    result = await request("/api/automation/runs/automation-smoke-1/release", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runnerId: "smoke-runner-a", reason: "test-release" }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.run.runnerId, "");
    assert.strictEqual(result.body.run.leaseDiagnostics.lastRunnerId, "smoke-runner-a", "released runs must preserve the last lease owner for reports");
    assert.strictEqual(result.body.run.leaseDiagnostics.lastReleaseReason, "test-release");
    assert(result.body.run.leaseDiagnostics.lastReleasedAt, "released runs must preserve the release timestamp");

    result = await request("/api/automation/runs/automation-smoke-1/lease/revalidate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runnerId: "smoke-runner-a", stepKey: "frame:frame-a:round-2:generate" }),
    });
    assert.strictEqual(result.response.status, 200, "paid-step revalidation should reacquire an absent lease for the same browser");
    assert.strictEqual(result.body.reacquired, true);
    assert.strictEqual(result.body.run.runnerId, "smoke-runner-a");
    assert.strictEqual(result.body.run.leaseDiagnostics.lastPaidStepKey, "frame:frame-a:round-2:generate");
    assert(result.body.run.leaseDiagnostics.lastPaidStepRevalidatedAt, "paid-step revalidation should remain visible in the run report");
    result = await request("/api/automation/runs/automation-smoke-1/release", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runnerId: "smoke-runner-a", reason: "test-complete" }),
    });
    assert.strictEqual(result.response.status, 200);

    result = await request("/api/automation/runs/automation-smoke-1/cancel", { method: "POST" });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.run.cancelRequested, true);
    const cancelledRevision = result.body.run.revision;

    result = await request("/api/automation/runs/automation-smoke-1", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: reviewRunRevision, cancelRequested: false, stage: "Stale browser write" }),
    });
    assert.strictEqual(result.response.status, 409, "stale run writes must be rejected");
    assert.strictEqual(result.body.code, "STALE_RUN");
    assert.strictEqual(result.body.run.cancelRequested, true, "a stale write must not clear a stop request");

    result = await request("/api/automation/runs/automation-smoke-1", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: cancelledRevision, cancelRequested: false, stage: "Cancellation remains sticky" }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.run.cancelRequested, true, "ordinary updates must not clear a stop request");
    result = await request("/api/automation/runs/automation-smoke-1");
    const stableUpdatedAt = result.body.run.updatedAt;
    result = await request("/api/automation/runs/automation-smoke-1");
    assert.strictEqual(result.body.run.updatedAt, stableUpdatedAt, "GET serialization must not mutate updatedAt");

    result = await request("/api/automation/runs");
    assert.strictEqual(result.response.status, 200);
    assert(result.body.runs.some((run) => run.id === "automation-smoke-1" && run.usage.imagesGenerated === 3));

    result = await request("/api/automation/reports/export?format=json");
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.appVersion, RELEASE_VERSION);
    assert.strictEqual(result.body.totals.runs, 1);
    assert.strictEqual(result.body.totals.imagesGenerated, 3);
    assert.strictEqual(result.body.totals.assistantCalls, 2);
    assert(result.body.perShot.some((row) => row.shotId === "S-01" && row.candidatesGenerated === 3));
    const safeJson = JSON.stringify(result.body);
    assert(!safeJson.includes(TEMP), "production JSON export must redact absolute paths");
    assert(!safeJson.includes("legacy-fal-key"), "production JSON export must redact secrets");
    result = await request("/api/automation/reports/export?format=markdown");
    assert.strictEqual(result.response.status, 200);
    assert.match(result.body, /# CineBraid production summary/);
    assert.match(result.body, /Provider requests accepted/);
    assert.match(result.body, /S-01/);
    assert(!String(result.body).includes(TEMP), "production Markdown export must redact absolute paths");
    result = await request("/api/automation/reports/export?format=xml");
    assert.strictEqual(result.response.status, 400);

    result = await request("/api/automation/runs/automation-smoke-1/archive", { method: "POST" });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.run.status, "archived");

    const derivedProject = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"));
    derivedProject.shots[0].keyframes.push({ id: "frame-b", label: "B", title: "End frame", description: "The worker has stepped away from the panel while the camera and room remain fixed.", required: true, winner: "" });
    derivedProject.shots[0].candidateFiles = [
      { stored: "FRAME_B_1.png", frameId: "frame-b", decision: "unreviewed" },
      { stored: "FRAME_B_2.png", frameId: "frame-b", decision: "unreviewed" },
    ];
    fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(derivedProject, null, 2));
    const derivedTakeDir = path.join(PROJECT_DIR, "shots", "S-01", "takes");
    fs.mkdirSync(derivedTakeDir, { recursive: true });
    for (const name of ["approved-start.png", "FRAME_B_1.png", "FRAME_B_2.png"]) fs.writeFileSync(path.join(derivedTakeDir, name), Buffer.from("mock-image"));
    const derivedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    derivedConfig.assistant.visionProvider = "ollama";
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(derivedConfig, null, 2));
    result = await request("/api/llm/review-derived-frame", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shotId: "S-01", frameId: "frame-b", fileNames: ["FRAME_B_1.png", "FRAME_B_2.png"] }),
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    assert.strictEqual(result.body.review.suggested, 1);
    assert.strictEqual(result.body.files[0], "FRAME_B_1.png");
    assert(result.body.context.some((item) => item.role.includes("parent frame")), "derived frame review must include the approved previous frame as visual context");
    const malformedReviewProject = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"));
    malformedReviewProject.shots[0].keyframes.find((frame) => frame.id === "frame-b").description = "OMIT_PASS_TEST";
    fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(malformedReviewProject, null, 2));
    result = await request("/api/llm/review-derived-frame", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shotId: "S-01", frameId: "frame-b", fileNames: ["FRAME_B_1.png", "FRAME_B_2.png"] }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.review.reviews[0].score, 99);
    assert.strictEqual(result.body.review.reviews[0].pass, false, "omitted pass must never be normalized into approval");
    assert.strictEqual(result.body.review.reviews[0].explicitPass, false);
    malformedReviewProject.shots[0].keyframes.find((frame) => frame.id === "frame-b").description = "OMIT_SCORE_TEST";
    fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(malformedReviewProject, null, 2));
    result = await request("/api/llm/review-derived-frame", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shotId: "S-01", frameId: "frame-b", fileNames: ["FRAME_B_1.png", "FRAME_B_2.png"] }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.review.reviews[0].score, 0, "omitted score must normalize to zero");
    assert.strictEqual(result.body.review.reviews[0].pass, true, "the explicit pass is retained for provenance but remains ineligible for auto-approval");
    assert.strictEqual(result.body.review.reviews[0].explicitScore, false);
    const sequenceProject = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"));
    const sequenceFrame = sequenceProject.shots[0].keyframes.find((frame) => frame.id === "frame-b");
    sequenceFrame.description = "The worker has stepped away from the panel while the camera, room, and background lights remain fixed.";
    sequenceFrame.winner = "FRAME_B_1.png";
    fs.writeFileSync(path.join(PROJECT_DIR, "project.json"), JSON.stringify(sequenceProject, null, 2));
    result = await request("/api/llm/review-frame-sequence", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shotId: "S-01", frameIds: ["frame-a", "frame-b"] }),
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    assert.strictEqual(result.body.files.length, 2);
    assert.strictEqual(result.body.review.pass, false, "a background-light continuity break must block motion readiness even when the model claims pass");
    assert.strictEqual(result.body.review.categories.lighting.score, 44);
    assert(result.body.review.blockingIssues.some((item) => /practical light/i.test(item)));
    derivedConfig.assistant.visionProvider = "none";
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(derivedConfig, null, 2));

    result = await request("/api/config");
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.execution, undefined);
    assert.match(result.body.generation.fal.apiKey, /^••••/);
    assert.strictEqual(result.body.generation.fal.apiKey.endsWith("-key"), true);
    const migratedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    assert.strictEqual(migratedConfig.execution, undefined);
    assert.strictEqual(migratedConfig.generation.fal.apiKey, "legacy-fal-key");

    result = await request("/api/agents/status");
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.agents.length, 6);
    assert.strictEqual(result.body.manualMode, true);
    assert.strictEqual(result.body.workload.policy, "one-heavy-task");
    assert(Array.isArray(result.body.workload.running));
    assert(Array.isArray(result.body.workload.queued));
    assert.strictEqual(result.body.capabilities.text.ready, false);
    assert.strictEqual(result.body.capabilities.vision.ready, false);
    assert.strictEqual(result.body.capabilities.embedding.ready, true);
    assert.strictEqual(
      result.body.agents.find((x) => x.id === "librarian").readiness.status,
      "ready",
    );
    assert.strictEqual(
      result.body.agents.find((x) => x.id === "coordinator").readiness.status,
      "blocked",
    );
    assert.strictEqual(
      result.body.agents.find((x) => x.id === "promptGuardian").readiness.status,
      "blocked",
    );
    assert.strictEqual(
      result.body.agents.find((x) => x.id === "continuity").readiness.status,
      "blocked",
    );

    result = await request("/api/agents/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "coordinator", scope: {} }),
    });
    assert.strictEqual(result.response.status, 400);
    assert.match(result.body.error, /disabled in AI Assistant settings/i);

    result = await request("/api/media/upload?type=media&name=animatic-frame.png", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: Buffer.from("cinebraid-smoke-animatic"),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.name, "animatic-frame.png");
    result = await request("/api/scan");
    assert.strictEqual(result.response.status, 200);
    assert(result.body.media.some((x) => x.name === "animatic-frame.png"));

    const mediaProject = (await request("/api/project")).body;
    mediaProject.mediaAssets = [
      {
        id: "media-smoke-animatic",
        file: "animatic-frame.png",
        title: "Animatic opening beat",
        originalName: "animatic-frame.png",
        createdAt: new Date().toISOString(),
        links: [
          {
            id: "link-smoke-shot",
            targetType: "shot",
            targetId: "S-01",
            role: "animatic-frame",
            beat: "start",
            timecode: "00:01.0",
            notes: "Use as composition context only.",
            agentContext: true,
            generationInput: false,
            order: 0,
          },
        ],
      },
    ];
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(mediaProject),
    });
    assert.strictEqual(result.response.status, 200);
    const savedMediaProject = (await request("/api/project")).body;
    assert.strictEqual(savedMediaProject.mediaAssets[0].links[0].role, "animatic-frame");
    assert.strictEqual(savedMediaProject.mediaAssets[0].links[0].generationInput, false);

    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        profileId: "gpt-image-2/blocking",
        purpose: "blocking",
        references: [],
        blockingLabels: true,
        blockingEmphasis: "auto",
        blockingFrameBrief: "Tight on rear wheels reversing onto skulls. Truck shows no damage.",
        blockingDirection: "Medium low on rear wheels.",
        composition: { camera: { shotSize: "wide", height: "eye-level", angle: "level", lens: "normal", view: "front", layout: "rule-of-thirds", crop: "full-scene" }, elements: [] },
        useLLM: false,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.match(result.body.compiledPrompt, /BLOCKING FRAME — shot S-01/);
    assert.match(result.body.compiledPrompt, /STYLE CONTRACT/);
    assert.match(result.body.compiledPrompt, /LABELS/);
    assert.match(result.body.compiledPrompt, /Close-up/);
    assert.match(result.body.compiledPrompt, /rear wheels dominate the foreground/i);
    assert.doesNotMatch(result.body.compiledPrompt, /Wide shot|Keep the full scene in frame/i);
    assert.strictEqual(result.body.blockingPlan.emphasis, "action-insert");
    assert.doesNotMatch(result.body.compiledPrompt, /IDENTITY CANON|RESTATE \(drift-prone|APPROVED VISUAL STYLE/i);
    assert.strictEqual(result.body.references.length, 0);
    assert.strictEqual(result.body.providerPayload.references.length, 0);
    assert(result.body.providerPayload.recommendedSettings.qualityLevel);
    assert.doesNotMatch((result.body.warnings || []).join(" "), /No reference images are selected|continuity may be weaker/i);

    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        profileId: "gpt-image-2/blocking",
        purpose: "blocking",
        references: [],
        blockingLabels: true,
        blockingEmphasis: "auto",
        blockingFrameBrief: "Tight on rear wheels reversing onto skulls.",
        blockingDirection: "Medium low on rear wheels.",
        composition: { camera: { shotSize: "wide", height: "eye-level", angle: "level", lens: "normal", view: "front", layout: "rule-of-thirds", crop: "full-scene" }, elements: [] },
        improveBlocking: true,
        useLLM: false
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.llmUsed, false);
    assert.strictEqual(result.body.blockingPlan.source, "deterministic");
    assert.match(result.body.compiledPrompt, /skulls are positioned directly at the physical contact point/i);
    assert.match((result.body.warnings || []).join(" "), /AI assistance is disabled/i);
    assert.doesNotMatch(result.body.compiledPrompt, /\{|"emphasis"/i);

    result = await request("/api/composer/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        mode: "suggest",
        frameBrief: "Tight on rear truck wheel reversing onto a skull.",
        direction: "Low camera at the point of contact.",
        emphasis: "auto",
        useLLM: true,
        references: [
          { key: "prop:truck", label: "Truck", role: "prop", entityId: "PROP-TRUCK" },
          { key: "prop:skull", label: "Skull", role: "prop", entityId: "PROP-SKULL" },
          { key: "location:gates", label: "Gates", role: "location", sourceType: "location", url: "/assets/plates/gates.png" }
        ],
        composition: { camera: { shotSize: "wide", crop: "full-scene", height: "eye-level", angle: "level", lens: "normal", view: "front", layout: "rule-of-thirds" }, elements: [] }
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.proposal.camera.shotSize, "close-up");
    assert.strictEqual(result.body.proposal.camera.crop, "detail");
    assert.strictEqual(result.body.proposal.elements.length, 2);
    assert.strictEqual(result.body.proposal.environmentBaseKey, "location:gates");
    assert.strictEqual(result.body.llmUsed, false);
    assert.match(result.body.proposal.summary, /tight insert/i);

    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        profileId: "gpt-image-2/multi-reference",
        purpose: "first-frame",
        references: [{ key: "blocking", label: "S-01 blocking", url: "/assets/shots/S-01/blocking/S-01_BLOCKING.png", role: "composition", mediaType: "image", approved: true, blocking: true, blockingAdherence: "strict" }],
        useLLM: false,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.match(result.body.compiledPrompt, /COMPOSITION GUIDE/);
    assert.match(result.body.compiledPrompt, /Do not render any text, labels?, lettering/i);
    assert.strictEqual(result.body.references[0].role, "composition");

    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        segmentId: "seg-a",
        profileId: "seedance-2/r2v",
        purpose: "motion",
        references: [
          { key: "start", label: "Approved Frame A", url: "/assets/shots/S-01/takes/approved-start.png", role: "first-frame", mediaType: "image", approved: true },
          { key: "blocking", label: "S-01 blocking", url: "/assets/shots/S-01/blocking/S-01_BLOCKING.png", role: "composition", mediaType: "image", approved: true, blocking: true, sourceRole: "blocking-frame" },
        ],
        directive: "The ship drifts slowly. Camera remains locked.",
        useLLM: false,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert(!result.body.references.some((ref) => ref.blocking || /blocking/i.test(ref.sourceRole || "")), "blocking references must be removed before motion compilation");
    assert.doesNotMatch(result.body.compiledPrompt, /S-01 blocking/i);

    result = await request("/api/shots/S-01/blocking?name=S-01_BLOCKING_TEST.png", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: Buffer.from("blocking-png-test"),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.storagePath, "shots/S-01/blocking/S-01_BLOCKING_TEST.png");
    assert(fs.existsSync(path.join(PROJECT_DIR, result.body.storagePath)));
    const blockingAsset = await fetch(base + result.body.url);
    assert.strictEqual(blockingAsset.status, 200);
    result = await request("/api/scan");
    assert((result.body.shots["S-01"].blocking || []).some((item) => item.name === "S-01_BLOCKING_TEST.png"));
    result = await request("/api/bible");
    assert.doesNotMatch(JSON.stringify(result.body), /S-01_BLOCKING_TEST\.png/, "blocking planning media must not enter the Project Bible");

    result = await request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agents: { models: { embedding: "missing-embed:1" } },
      }),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/agents/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "librarian", scope: {} }),
    });
    assert.strictEqual(result.response.status, 400);
    assert.match(result.body.error, /ollama pull missing-embed:1/);
    result = await request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agents: { models: { embedding: "qwen3-embedding:4b" } },
      }),
    });
    assert.strictEqual(result.response.status, 200);

    result = await request("/api/agents/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "librarian", scope: { smoke: true } }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.ok, true);
    assert.match(result.body.run.id, /^agent-/);
    const firstRunId = result.body.run.id;

    result = await request("/api/agents/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "librarian", scope: { queued: true } }),
    });
    const queuedRunId = result.body.run.id;
    result = await request(`/api/agents/runs/${queuedRunId}/cancel`, {
      method: "POST",
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.run.status, "CANCELLED");

    const completed = await waitForAgent(firstRunId, ["COMPLETED"]);
    assert.strictEqual(completed.status.index.ready, true);
    assert.strictEqual(completed.status.index.stale, false);

    const projectBeforeChange = (await request("/api/project")).body;
    projectBeforeChange.meta.version = "v2";
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(projectBeforeChange),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/agents/status");
    assert.strictEqual(result.body.index.stale, true);

    result = await request("/api/prompt/profiles");
    assert.strictEqual(result.response.status, 200);
    assert(Array.isArray(result.body.profiles));

    result = await request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assistant: { provider: "ollama" }, routing: { prompt: "ollama" } }),
    });
    assert.strictEqual(result.response.status, 200);

    result = await request("/api/assistant/test", { method: "POST" });
    assert.strictEqual(result.response.status, 200);
    assert.match(result.body.message || "", /CineBraid assistant connected/i);
    assert.strictEqual(ollamaChatBodies.at(-1)?.think, false, "native Ollama text calls must disable thinking so final content is returned");

    result = await request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ollamaModel: "fallback-response-test" }),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/assistant/test", { method: "POST" });
    assert.strictEqual(result.response.status, 200, "assistant test should recover through Ollama generate fallback");
    assert.match(result.body.message || "", /CineBraid assistant connected/i);

    result = await request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ollamaModel: "empty-response-test" }),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/assistant/test", { method: "POST" });
    assert.strictEqual(result.response.status, 500, "assistant connection tests must fail on empty final content");
    assert.match(result.body.error || "", /empty final response/i);
    result = await request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ollamaModel: "qwen3.6:35b-a3b" }),
    });
    assert.strictEqual(result.response.status, 200);

    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        profileId: "gpt-image-2/blocking",
        purpose: "blocking",
        references: [],
        blockingLabels: true,
        blockingEmphasis: "auto",
        blockingFrameBrief: "Tight on rear wheels reversing onto skulls.",
        blockingDirection: "Low camera at the point of contact.",
        composition: { camera: { shotSize: "wide", height: "eye-level", angle: "level", lens: "normal", view: "front", layout: "rule-of-thirds", crop: "full-scene" }, elements: [] },
        improveBlocking: true,
        useLLM: true,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.llmUsed, true);
    assert.strictEqual(result.body.blockingPlan.source, "assistant");
    assert.strictEqual(ollamaChatBodies.at(-1)?.think, false);
    assert.strictEqual(ollamaChatBodies.at(-1)?.format, "json", "strict local blocking tasks must use Ollama structured JSON output");

    const timeoutStarted = Date.now();
    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        profileId: "gpt-image-2/t2i",
        purpose: "shot-still",
        references: [],
        directive: "FORCE_TIMEOUT_TEST",
        useLLM: true,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert(Date.now() - timeoutStarted < 5000, "three timed-out assistant attempts should still return deterministic prompt within the bounded recovery window");
    assert.match((result.body.warnings || []).join(" "), /timed out/i);

    const comparisonProfiles = [
      "seedance-2/i2v",
      "kling-3/i2v",
      "ltx-2.3/i2v",
      "happy-horse-1.1/i2v",
      "wan-2.7/i2v",
    ];
    const comparisonResults = new Map();
    for (const profileId of comparisonProfiles) {
      result = await request("/api/prompt/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shotId: "S-01",
          segmentId: "seg-a",
          profileId,
          purpose: "motion",
          references: [
            {
              key: "take:approved-start.png",
              label: "Frame A · approved-start.png",
              url: "/assets/shots/S-01/takes/approved-start.png",
              role: "first-frame",
              approved: true,
            },
          ],
          directive:
            "The ship hangs in the dark; the slowest drift and rotation; a running light blinks. Camera remains locked. No other motion.",
          useLLM: false,
        }),
      });
      assert.strictEqual(result.response.status, 200, profileId);
      comparisonResults.set(profileId, result.body);
    }
    assert.strictEqual(
      new Set(
        [...comparisonResults.values()].map((x) => x.compiledPrompt),
      ).size,
      comparisonProfiles.length,
      "I2V target comparison should produce visibly distinct compiled prompts",
    );
    assert.match(
      comparisonResults.get("kling-3/i2v").compiledPrompt,
      /supplied starting image/i,
    );
    assert.match(
      comparisonResults.get("ltx-2.3/i2v").compiledPrompt,
      /10-second shot/i,
    );
    assert.match(
      comparisonResults.get("happy-horse-1.1/i2v").compiledPrompt,
      /Visible motion only/i,
    );
    assert.match(
      comparisonResults.get("wan-2.7/i2v").compiledPrompt,
      /SUBJECT MOTION:/,
    );
    assert(
      comparisonResults.get("wan-2.7/i2v").providerPayload.negativePrompt,
    );
    assert.strictEqual(
      comparisonResults.get("wan-2.7/i2v").providerPayload
        .recommendedSettings.enhance,
      false,
    );

    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        segmentId: "seg-a",
        profileId: "kling-3/i2v",
        purpose: "motion",
        references: [
          {
            key: "take:approved-start.png",
            label: "Frame A · approved-start.png",
            url: "/assets/shots/S-01/takes/approved-start.png",
            role: "first-frame",
            approved: true,
          },
        ],
        directive:
          "Primary motion: NESTED_JSON_TEST. The ship hangs in the dark; the slowest drift/rotation; a running light blinks. Camera (hull cam) is fixed. No other motion. Motion intensity: subtle. Preserve the approved composition, character identity, environment geometry, and object design. Audio timing intent: Synchronization: natural.",
        audioContext: "Synchronization: natural",
        audio: { dialogue: "", sfx: "", ambience: "" },
        motionSync: "natural",
        motionIntensity: "subtle",
        preserveComposition: true,
        useLLM: true,
        improveMotion: true,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.llmUsed, true);
    assert.strictEqual(result.body.compilerVersion, "3.0.0");
    assert.strictEqual(result.body.sourceDirectiveSanitized, true);
    assert.doesNotMatch(result.body.improvedDirective, /[{}]|"directive"|\\n/i);
    assert.doesNotMatch(result.body.improvedDirective, /audio|sound|chirp|synchron/i);
    assert.doesNotMatch(result.body.compiledPrompt, /[{}]|"directive"|\\n/i);
    assert.doesNotMatch(result.body.compiledPrompt, /audio|sound|chirp|synchron/i);
    assert.doesNotMatch(result.body.originalDirective, /Motion intensity|Preserve the approved|Audio timing intent/i);
    assert.match(result.body.compiledPrompt, /supplied starting image/i);
    assert.match(result.body.compiledPrompt, /camera (?:does not move|remains locked)/i);

    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        segmentId: "seg-a",
        profileId: "wan-2.7/i2v",
        purpose: "motion",
        references: [
          {
            key: "take:approved-start.png",
            label: "Frame A · approved-start.png",
            url: "/assets/shots/S-01/takes/approved-start.png",
            role: "first-frame",
            approved: true,
          },
        ],
        directive: "LABELLED_TEXT_TEST. The ship drifts slowly and the running light blinks. Camera remains locked.",
        audio: {},
        motionSync: "none",
        useLLM: true,
        improveMotion: true,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.llmUsed, true);
    assert.match(result.body.compiledPrompt, /SUBJECT MOTION:/);
    assert.match(result.body.compiledPrompt, /CAMERA:/);
    assert.doesNotMatch(result.body.improvedDirective, /DIRECTIVE:|CHANGES:|[{}]/i);
    assert.doesNotMatch((result.body.warnings || []).join(" "), /rewrite unavailable/i);

    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        segmentId: "seg-a",
        profileId: "happy-horse-1.1/i2v",
        purpose: "motion",
        references: [
          {
            key: "take:approved-start.png",
            label: "Frame A · approved-start.png",
            url: "/assets/shots/S-01/takes/approved-start.png",
            role: "first-frame",
            approved: true,
          },
        ],
        directive: "UNUSABLE_MOTION_TEST. The ship drifts slowly. Camera remains locked.",
        audio: {},
        motionSync: "none",
        useLLM: true,
        improveMotion: true,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.llmUsed, false);
    assert.match((result.body.warnings || []).join(" "), /rewrite unavailable/i);
    assert.match(result.body.compiledPrompt, /Visible motion only/i);
    assert.doesNotMatch(result.body.compiledPrompt, /[{}]|"changes"/i);

    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        segmentId: "seg-a",
        durationSeconds: 12,
        profileId: "seedance-2/r2v",
        purpose: "motion",
        references: [
          { key: "start", label: "Approved Frame A", url: "/assets/shots/S-01/takes/approved-start.png", role: "first-frame", mediaType: "image", approved: true },
          { key: "identity", label: "Kai identity", url: "/assets/anchors/KAI.png", role: "identity", mediaType: "image", approved: true },
          { key: "prop", label: "Panel tool", url: "/assets/props/TOOL.png", role: "prop", mediaType: "image", approved: true },
          { key: "audio", label: "Dialogue timing", url: "/assets/audio/line.wav", role: "audio-timing", mediaType: "audio", approved: true },
        ],
        directive: "The worker lifts the tool, checks the panel, and looks toward camera while the ship drifts slowly.",
        audio: { dialogue: "System check complete.", ambience: "Low hull rumble." },
        motionSync: "lip-sync",
        motionIntensity: "moderate",
        preserveComposition: true,
        useLLM: false,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.spec.durationSeconds, 12);
    assert.match(result.body.compiledPrompt, /one continuous 12-second shot/i);
    assert.match(result.body.compiledPrompt, /OMNI REFERENCE CONTRACT/);
    assert.match(result.body.compiledPrompt, /IDENTITY: Kai identity/);
    assert.match(result.body.compiledPrompt, /PROP: Panel tool/);
    assert.doesNotMatch((result.body.warnings || []).join(" "), /30 seconds|planned for 4–15/i);

    result = await request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assistant: { provider: "ollama", visionProvider: "ollama" },
      }),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/agents/status");
    assert.strictEqual(result.body.manualMode, false);
    assert.strictEqual(result.body.capabilities.text.ready, true);
    assert.strictEqual(result.body.capabilities.vision.ready, true);
    assert.strictEqual(
      result.body.agents.find((x) => x.id === "promptGuardian").readiness.status,
      "ready",
    );

    const entityReviewProject = (await request("/api/project")).body;
    entityReviewProject.props = [
      {
        id: "PROP-REVIEW",
        name: "Panel tool",
        notes: "Compact steel maintenance tool with a black rubber grip.",
        creationDescription: "Compact steel maintenance tool with a black rubber grip and one brass service latch.",
        approvedFile: "PROP-REVIEW-DEFAULT.png",
        continuityStates: [
          { id: "state-default", name: "Default", isDefault: true, approvedFile: "PROP-REVIEW-DEFAULT.png", notes: "Clean tool." },
          { id: "state-damaged", name: "Damaged", isDefault: false, approvedFile: "", notes: "Scratched casing and chipped grip.", parentStateId: "state-default", generationMode: "derive" },
        ],
        candidateFiles: [{ stored: "PROP-REVIEW-CANDIDATE.png", decision: "unreviewed" }],
      },
    ];
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(entityReviewProject),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/prompt/asset-compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        list: "props",
        id: "PROP-REVIEW",
        stateId: "state-damaged",
        parentStateId: "state-default",
        generationMode: "derive",
        profileId: "gpt-image-2/edit",
        directive: "Keep a clean three-quarter production-reference view.",
        useLLM: false,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.state.id, "state-damaged");
    assert.strictEqual(result.body.state.parentStateId, "state-default");
    assert.strictEqual(result.body.state.generationMode, "derive");
    assert.strictEqual(result.body.profile.mode, "edit", "derived states must compile through the real reference-edit API contract");
    assert.strictEqual(result.body.references[0].role, "base", "derived edit prompts must bind the approved parent as #image1");
    assert.match(result.body.compiledPrompt, /Edit #image1/i);
    assert.match(result.body.compiledPrompt, /Scratched casing and chipped grip/i);
    assert.match(result.body.compiledPrompt, /Keep a clean three-quarter production-reference view/i,
      "a caller-supplied directive must appear in the compiled prompt");

    /* The same question on the default-state text-to-image path, which is where
       it was actually being answered wrongly. A derived edit brief leaves
       stagingLines empty, so the directive written to initialState.staging was
       picked up by the compiler's fallback and looked fine. A default asset brief
       always fills stagingLines from positioning, the fallback therefore never
       fires, and the directive vanished from every compiled prompt: the reference
       workspace's own "Asset-specific direction" field and durable automation's
       pass-to-pass correction were both discarded here. */
    const defaultCompile = await request("/api/prompt/asset-compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        list: "props",
        id: "PROP-REVIEW",
        profileId: "gpt-image-2/t2i",
        directive: "AUTOMATION REVISION\nCORRECT: raise facial exposure so identity is verifiable.",
        useLLM: false,
      }),
    });
    assert.strictEqual(defaultCompile.response.status, 200);
    assert.match(defaultCompile.body.compiledPrompt, /raise facial exposure so identity is verifiable/i,
      "a directive on the default text-to-image path must reach the compiled prompt");
    assert.match(defaultCompile.body.compiledPrompt, /AUTOMATION REVISION/,
      "the correction heading must survive so the revision is legible in the prompt");
    assert.match(result.body.sourceContext.shot.description, /Continuity target: Damaged/i);
    assert.match(result.body.sourceContext.shot.description, /Scratched casing and chipped grip/i);
    assert((result.body.spec.mustPreserve || []).some((item) => /Default.*does not explicitly change/i.test(item)), "state prompt must preserve unaffected parent-state features");
    assert((result.body.spec.mustAvoid || []).some((item) => /unrequested redesign/i.test(item)), "state prompt must forbid changes outside the continuity delta");

    fs.writeFileSync(path.join(PROJECT_DIR, "props", "PROP-REVIEW-DEFAULT.png"), Buffer.from("mock-default-prop-image"));
    fs.writeFileSync(path.join(PROJECT_DIR, "props", "PROP-REVIEW-CANDIDATE.png"), Buffer.from("mock-prop-image"));
    result = await request("/api/llm/review-entity-candidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ list: "props", id: "PROP-REVIEW", fileName: "PROP-REVIEW-CANDIDATE.png", stateId: "state-damaged" }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.review.score, 88);
    assert.strictEqual(result.body.review.pass, true);
    assert.strictEqual(result.body.review.categories.state.severity, "minor");
    assert.strictEqual(result.body.state.name, "Damaged");
    assert.strictEqual(result.body.inputLabels[0].role, "candidate under review");
    assert.strictEqual(result.body.inputLabels[1].role, "exact parent-state editable authority");
    assert.strictEqual(result.body.review.contractVersion, "reference-authority-v3");
    assert.strictEqual(result.body.authorityMode, "validate", "an approved parent reference means the route is validating, not establishing");
    assert(result.body.requiredHardChecks.includes("sameUnderlyingEntity"), "identity stays gated when authority exists");
    assert(result.body.requiredHardChecks.includes("onlyRequestedDelta"), "a derived state's delta stays gated when authority exists");

    /* v667 — the same route, with no approved authority anywhere. The workflow
       that creates the first reference must not be blocked for not already
       having one. */
    const bootstrapProject = JSON.parse(JSON.stringify(entityReviewProject));
    bootstrapProject.props[0].approvedFile = "";
    bootstrapProject.props[0].continuityStates[0].approvedFile = "";
    bootstrapProject.props[0].continuityStates[1].approvedFile = "";
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(bootstrapProject),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/llm/review-entity-candidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ list: "props", id: "PROP-REVIEW", fileName: "PROP-REVIEW-CANDIDATE.png", stateId: "state-default" }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.authorityMode, "establish", "no approved authority means the route is establishing one");
    assert.deepStrictEqual(result.body.requiredHardChecks, [], "no comparison gate may be required when there is nothing to compare against");
    assert.strictEqual(result.body.review.outcome, "ready-to-establish-authority");
    assert.strictEqual(result.body.review.generationCorrectable, false, "a missing prior authority must never become a generation correction");
    assert(result.body.review.blockers.every((row) => row.actionability !== "generation-correctable"));
    assert(result.body.relatedStates.some((row) => row.name === "Damaged"), "sibling states must reach the reviewer so a wrong-state candidate is nameable");

    /* And a candidate that belongs to a sibling state still cannot pass. */
    const mismatchProject = JSON.parse(JSON.stringify(bootstrapProject));
    mismatchProject.props[0].continuityStates[0].notes = "FORCE_STATE_MISMATCH Clean tool.";
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(mismatchProject),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/llm/review-entity-candidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ list: "props", id: "PROP-REVIEW", fileName: "PROP-REVIEW-CANDIDATE.png", stateId: "state-default" }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.review.pass, false, "a sibling-state candidate must not pass the requested state");
    assert.strictEqual(result.body.review.stateMatch.closerState, "Damp inside");
    assert.strictEqual(result.body.review.outcome, "correctable", "moving the subject back is something generation can do");

    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(entityReviewProject),
    });
    assert.strictEqual(result.response.status, 200);

    entityReviewProject.props[0].continuityStates[1].notes = "FORCE_MAJOR_PASS Scratched casing and chipped grip.";
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(entityReviewProject),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/llm/review-entity-candidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ list: "props", id: "PROP-REVIEW", fileName: "PROP-REVIEW-CANDIDATE.png", stateId: "state-damaged" }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.review.modelPass, true, "the mock reviewer should still claim a pass");
    assert.strictEqual(result.body.review.pass, false, "a major category must hard-fail even when the model claims pass");
    assert(result.body.review.hardGateFailures.includes("category:major"));
    assert.notStrictEqual(result.body.review.recommendation, "approve");

    entityReviewProject.props[0].name = "The 1974 snapshot";
    entityReviewProject.props[0].notes = "A small printed photograph whose exact internal image is continuity-critical.";
    entityReviewProject.props[0].continuityStates[1].notes = "FORCE_EMBEDDED_MISMATCH Tape the exact same photograph to the tile; change only the tape and placement.";
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(entityReviewProject),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/llm/review-entity-candidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ list: "props", id: "PROP-REVIEW", fileName: "PROP-REVIEW-CANDIDATE.png", stateId: "state-damaged" }),
    });
    assert.strictEqual(result.response.status, 200);
    assert(result.body.requiredHardChecks.includes("sameEmbeddedContent"), "image-bearing props must require embedded-content identity");
    assert.strictEqual(result.body.review.pass, false, "replacing the internal photograph must fail regardless of score");
    assert(result.body.review.hardGateFailures.includes("sameEmbeddedContent"));

    entityReviewProject.locations = [{
      id: "LOC-REVIEW",
      name: "Municipal pool",
      notes: "One exact tiled pool room with fixed windows, railings, drains and doors.",
      approvedFile: "LOC-REVIEW-MASTER.png",
      continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "LOC-REVIEW-MASTER.png", notes: "Canonical room." }],
      coverageSlots: [
        { id: "establishing", label: "Master establishing", required: true, approvedFile: "LOC-REVIEW-MASTER.png" },
        { id: "reverse", label: "Reverse angle", required: true, approvedFile: "LOC-REVIEW-REVERSE.png" },
        { id: "left-coverage", label: "Left coverage", required: true, approvedFile: "" },
      ],
      candidateFiles: [{ stored: "LOC-REVIEW-LEFT.png", decision: "unreviewed", targetCoverageSlotId: "left-coverage", targetCoverageSlotName: "Left coverage", coverageGroup: "angles", referenceView: "left-profile", targetStateId: "state-default" }],
    }];
    for (const name of ["LOC-REVIEW-MASTER.png", "LOC-REVIEW-REVERSE.png", "LOC-REVIEW-LEFT.png"]) fs.writeFileSync(path.join(PROJECT_DIR, "plates", name), Buffer.from(`mock-${name}`));
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(entityReviewProject),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/llm/review-entity-candidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ list: "locations", id: "LOC-REVIEW", fileName: "LOC-REVIEW-LEFT.png", stateId: "state-default" }),
    });
    assert.strictEqual(result.response.status, 200);
    assert(result.body.requiredHardChecks.includes("sameSpatialGeometry"));
    assert(result.body.requiredHardChecks.includes("requestedViewCorrect"));
    const locationAuthorityFiles = result.body.inputLabels.slice(1).map((row) => row.fileName);
    assert(locationAuthorityFiles.includes("LOC-REVIEW-MASTER.png"));
    assert(locationAuthorityFiles.includes("LOC-REVIEW-REVERSE.png"), "location review must compare against every approved angle, not only the primary");

    result = await request("/api/prompt/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        references: [
          {
            url: "/assets/media/animatic-frame.png",
            role: "composition",
            label: "Animatic opening beat",
          },
        ],
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert(result.body.analysis);

    const guardianProject = (await request("/api/project")).body;
    const guardianPackage = comparisonResults.get("wan-2.7/i2v");
    guardianProject.shots[0].clips[0].generationPackages.push({
      id: "pkg-smoke-guardian",
      date: new Date().toISOString(),
      kind: "video",
      mode: "i2v",
      purpose: "motion",
      profileId: guardianPackage.profile.id,
      profileName: guardianPackage.profile.name,
      prompt: guardianPackage.compiledPrompt,
      spec: guardianPackage.spec,
      providerPayload: guardianPackage.providerPayload,
      references: guardianPackage.references,
      warnings: guardianPackage.warnings,
      confirmations: guardianPackage.confirmations,
    });
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(guardianProject),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/agents/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "promptGuardian",
        scope: { shotId: "S-01", segmentId: "seg-a" },
      }),
    });
    assert.strictEqual(result.response.status, 200);
    const guardianRun = await waitForAgent(result.body.run.id, ["COMPLETED"]);
    assert.strictEqual(guardianRun.run.result.metrics.profile, "wan-2.7/i2v");
    assert(guardianRun.run.result.checks.length >= 6);
    assert(
      guardianRun.run.result.checks.some(
        (x) => x.label === "Wan negative field" && x.status === "pass",
      ),
    );
    assert.match(guardianRun.run.result.reviewedPrompt, /SUBJECT MOTION:/);
    assert(guardianRun.run.result.providerPayload.negativePrompt);

    const weakProject = (await request("/api/project")).body;
    weakProject.shots[0].clips[0].generationPackages.push({
      id: "pkg-weak-guardian",
      date: new Date().toISOString(),
      kind: "video",
      mode: "i2v",
      purpose: "motion",
      profileId: "seedance-2/i2v",
      profileName: "Seedance 2 — Image to Video",
      prompt: "The ship moves closer.",
      providerPayload: {
        prompt: "The ship moves closer.",
        references: [{ role: "first-frame", approved: true }],
      },
      references: [{ role: "first-frame", approved: true }],
    });
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(weakProject),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/agents/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "promptGuardian",
        scope: { shotId: "S-01", segmentId: "seg-a" },
      }),
    });
    assert.strictEqual(result.response.status, 200);
    const weakGuardian = await waitForAgent(result.body.run.id, ["COMPLETED"]);
    assert.strictEqual(weakGuardian.run.result.verdict, "improve");
    assert(weakGuardian.run.result.proposedPrompt.length > 20);
    assert.doesNotMatch(
      weakGuardian.run.result.proposedPrompt,
      /^(?:rewrite|revise|add|use|prompt should)/i,
    );
    assert(
      weakGuardian.run.result.checks.some(
        (x) => x.label === "Production usefulness" && x.status === "warn",
      ),
    );
    result = await request(
      `/api/agents/runs/${weakGuardian.run.id}/apply-prompt`,
      { method: "POST" },
    );
    assert.strictEqual(result.response.status, 200);
    const appliedRevisionId = result.body.package.id,
      appliedGuardianProject = (await request("/api/project")).body,
      guardianPackages = resolvePromptBuildList(appliedGuardianProject, appliedGuardianProject.shots[0].clips[0].generationPackages),
      sourcePackage = guardianPackages.find((x) => x.id === "pkg-weak-guardian"),
      appliedPackage = guardianPackages.find((x) => x.id === appliedRevisionId);
    assert.strictEqual(sourcePackage.prompt, "The ship moves closer.");
    assert(Number(sourcePackage.revision) > 0);
    assert(appliedPackage);
    assert.strictEqual(appliedPackage.revision, sourcePackage.revision + 1);
    assert.notStrictEqual(appliedPackage.id, sourcePackage.id);
    assert.strictEqual(appliedPackage.parentPackageId, sourcePackage.id);
    assert.strictEqual(appliedPackage.revisionReason, "prompt-guardian");
    assert.strictEqual(
      appliedPackage.prompt,
      weakGuardian.run.result.proposedPrompt,
    );
    assert.strictEqual(
      appliedPackage.providerPayload.prompt,
      weakGuardian.run.result.proposedPrompt,
    );
    assert.strictEqual(appliedPackage.guardianHistory.length, 1);

    const stageProject = (await request("/api/project")).body;
    stageProject.shots[0].positioning = "";
    result = await request("/api/projects/smoke-project/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "*" },
      body: JSON.stringify(stageProject),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assistant: { provider: "ollama" } }),
    });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/agents/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "coordinator",
        scope: { shotId: "S-01", stage: "plan" },
      }),
    });
    assert.strictEqual(result.response.status, 200);
    const stageRun = await waitForAgent(result.body.run.id, ["COMPLETED"]);
    assert.strictEqual(stageRun.run.result.stageDraft.stage, "plan");
    assert(
      stageRun.run.result.stageDraft.changes.some(
        (x) => x.path === "shot.positioning",
      ),
    );
    result = await request(`/api/agents/runs/${stageRun.run.id}/apply-stage`, {
      method: "POST",
    });
    assert.strictEqual(result.response.status, 200);
    const guidedProject = (await request("/api/project")).body;
    assert.match(guidedProject.shots[0].positioning, /Locked exterior hull-camera/);
    assert(guidedProject.shots[0].agentChangeHistory.length >= 1);

    result = await request("/api/project-builder/system-prompt");
    assert.strictEqual(result.response.status, 200);
    assert.match(String(result.body), /CineBraid v6\.5\.3 planning JSON object/);
    assert.match(String(result.body), /4 and 15 seconds/);
    assert.doesNotMatch(String(result.body), /v5\.8/);

    result = await request("/api/project-builder/kit");
    assert.strictEqual(result.response.status, 200);
    assert.match(
      result.response.headers.get("content-disposition") || "",
      /Prompt_Kit_v6\.5\.3\.zip/,
    );

    const leanImport = {
      meta: {
        title: "Lean Import Smoke",
        format: "Short",
        aspectRatio: "16:9",
        globalStylePrompt: "Naturalistic low-key science-fiction photography.",
      },
      qcChecklist: ["Keep the worker identity consistent", "Preserve panel geometry"],
      characters: [
        {
          id: "CHAR-WORKER",
          name: "Worker",
          block: "A maintenance worker in a practical suit.",
          visualDescription: "Dark utility suit with a rectangular shoulder patch.",
          audio: { voiceDesignPrompt: "A calm mid-register adult voice with measured technical delivery." },
        },
      ],
      locations: [],
      props: [],
      audio: [
        {
          id: "VOICE-WORKER-CLEAN",
          name: "Worker clean voice master",
          role: "voice",
          notes: "Record once; radio filtering happens in post.",
          cleanMaster: true,
          sameObjectAs: "",
        },
      ],
      scenes: [
        {
          id: "S01",
          title: "Hull repair",
          characters: ["CHAR-WORKER"],
          whatHappens: "The worker repairs a panel.",
          howItFeels: "Quiet and tense.",
        },
      ],
      shots: [
        {
          id: "S01-01",
          scene: "S01",
          title: "Repair wide",
          desc: "The worker reaches toward the damaged hull panel.",
          positioning: "Locked wide view; worker left, panel right, hand near the controls.",
          route: "GENERATE",
          codes: [],
          characters: ["CHAR-WORKER"],
          risks: ["Hand-panel contact"],
          dur: 0,
          audio: {
            line: "Panel pressure stable.",
            speakerId: "CHAR-WORKER",
            note: "Clean master; radio treatment in post. Never quote this note.",
            voiceEntityId: "VOICE-WORKER-CLEAN",
            vo: "Legacy production note retained for compatibility.",
            sfx: "Soft tool click.",
          },
          continuityStateSelections: {},
          clips: [
            {
              title: "Reference-led repair",
              dur: 30,
              kind: "r2v",
              motionPrompt: "The worker slowly reaches to the panel while the camera stays fixed.",
              line: "Pressure holds.",
              speakerId: "CHAR-WORKER",
              audioNote: "Use the same clean voice master; filter in post.",
              voiceEntityId: "VOICE-WORKER-CLEAN",
              emotion: "tense but controlled",
              delivery: "quiet and precise",
              music: "Sparse low pulse.",
              motionBrief: {
                performance: { action: "The worker reaches toward the panel.", gaze: "panel controls", endingState: "hand on the repaired latch" },
                camera: { movement: "locked", timing: "no movement" },
                dialogue: { line: "Pressure holds.", speakerId: "CHAR-WORKER", language: "English", emotion: "controlled", delivery: "quiet", locked: true, lipSyncRequired: true },
                sound: { sfxEvents: [{ timing: "1.2s", event: "soft tool click", intensity: "restrained" }], ambience: "low hull room tone", music: "sparse low pulse" },
                output: { resolution: "720p", nativeAudio: true }
              },
            },
          ],
          winner: "invented-final.mp4",
          candidateFiles: [{ file: "invented.png" }],
        },
      ],
      mediaAssets: [{ id: "FAKE" }],
      decisions: [{ summary: "Invented decision" }],
      sessions: [{ summary: "Invented history" }],
    };
    result = await request("/api/projects/preview-import-json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: leanImport }),
    });
    assert.strictEqual(result.response.status, 200);
    const importPreview = structuredClone(result.body);
    assert.match(importPreview.previewToken, /^[A-Za-z0-9_-]+$/);
    assert.match(importPreview.previewHash, /^[a-f0-9]{64}$/);
    assert.strictEqual(result.body.review.counts.shots, 1);
    assert.strictEqual(result.body.review.sourceCounts.keyframes, 0);
    assert.strictEqual(result.body.review.counts.keyframes, 1);
    assert(result.body.review.inferred.length >= 3);
    assert(
      result.body.review.inferred.some(
        (item) => item.path && /\[INFERRED FOR PLANNING\]/i.test(item.value),
      ),
    );
    assert.strictEqual(result.body.normalizedProject.sessions.length, 1);
    assert.strictEqual(result.body.normalizedProject.audio[0].cleanMaster, true);
    assert.strictEqual(result.body.normalizedProject.shots[0].audio.line, "Panel pressure stable.");
    assert.strictEqual(result.body.normalizedProject.shots[0].audio.note, "Clean master; radio treatment in post. Never quote this note.");
    assert.strictEqual(result.body.normalizedProject.shots[0].audio.speakerId, "CHAR-WORKER");
    assert.strictEqual(result.body.normalizedProject.shots[0].audio.voiceEntityId, "VOICE-WORKER-CLEAN");
    assert.strictEqual(result.body.normalizedProject.shots[0].clips[0].line, "Pressure holds.");
    assert.strictEqual(result.body.normalizedProject.shots[0].clips[0].audioNote, "Use the same clean voice master; filter in post.");
    assert.strictEqual(result.body.normalizedProject.shots[0].clips[0].motionBrief.dialogue.line, "Pressure holds.");
    assert.strictEqual(result.body.normalizedProject.shots[0].clips[0].motionBrief.dialogue.locked, true);
    assert.strictEqual(result.body.normalizedProject.shots[0].clips[0].motionBrief.sound.sfxEvents[0].timing, "1.2s");
    assert.strictEqual(result.body.normalizedProject.shots[0].clips[0].motionBrief.output.resolution, "720p");
    assert(
      result.body.review.review.some((item) =>
        /4–15 seconds|30s|reference-led duration/i.test(item),
      ),
    );
    assert(
      result.body.review.removed.some((item) =>
        /generated|runtime|history|cleared/i.test(item),
      ),
    );

    result = await request("/api/projects/import-json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        previewToken: importPreview.previewToken,
        previewHash: "0".repeat(64),
      }),
    });
    assert.strictEqual(result.response.status, 400);
    assert.match(result.body.error, /hash does not match/i);

    leanImport.meta.title = "Mutated After Preview";
    result = await request("/api/projects/import-json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        previewToken: importPreview.previewToken,
        previewHash: importPreview.previewHash,
      }),
    });
    assert.strictEqual(result.response.status, 200);
    const importedPath = path.join(PROJECTS_ROOT, result.body.slug, "project.json"),
      importedProject = JSON.parse(fs.readFileSync(importedPath, "utf8"));
    assert.deepStrictEqual(importedProject, importPreview.normalizedProject);
    assert.strictEqual(importedProject.qcChecklist.length, 5);
    assert.strictEqual(importedProject.characters[0].continuityStates.length, 1);
    assert.strictEqual(importedProject.characters[0].continuityStates[0].isDefault, true);
    assert.strictEqual(importedProject.scenes[0].tier, "B");
    assert.strictEqual(importedProject.shots[0].keyframes.length, 1);
    assert.strictEqual(
      importedProject.shots[0].clips[0].fromFrame,
      importedProject.shots[0].keyframes[0].id,
    );
    assert.strictEqual(importedProject.shots[0].dur, 30);
    assert.strictEqual(importedProject.shots[0].winner, null);
    assert.deepStrictEqual(importedProject.shots[0].candidateFiles, []);
    assert.deepStrictEqual(importedProject.mediaAssets, []);
    assert.deepStrictEqual(importedProject.decisions, []);
    assert.strictEqual(importedProject.sessions.length, 1);
    assert.strictEqual(importedProject.meta.hubVersion, "v6.0.0");

    result = await request("/api/projects/import-json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        previewToken: importPreview.previewToken,
        previewHash: importPreview.previewHash,
      }),
    });
    assert.strictEqual(result.response.status, 400);
    assert.match(result.body.error, /missing or expired/i);

    result = await request("/api/projects/import-json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: leanImport }),
    });
    assert.strictEqual(result.response.status, 400);
    assert.match(result.body.error, /missing or expired/i);

    result = await request("/api/projects/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "smoke-project" }),
    });
    assert.strictEqual(result.response.status, 200);

    // Repair.7: MiniMax H3 mixed keyframe roles must remain temporal waypoints.
    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01",
        profileId: "minimax-h3/multi-frame",
        purpose: "motion",
        useLLM: false,
        durationSeconds: 10,
        directive: "Move continuously through all four approved beats.",
        references: [
          { key: "h3-a", role: "first-frame", label: "Opening A", approved: true, mediaType: "image", url: "/assets/shots/S-01/takes/a.png" },
          { key: "h3-b", role: "keyframe", label: "Middle B", approved: true, mediaType: "image", url: "/assets/shots/S-01/takes/b.png" },
          { key: "h3-c", role: "keyframe", label: "Middle C", approved: true, mediaType: "image", url: "/assets/shots/S-01/takes/c.png" },
          { key: "h3-d", role: "last-frame", label: "Ending D", approved: true, mediaType: "image", url: "/assets/shots/S-01/takes/d.png" },
        ],
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.match(result.body.compiledPrompt, /Use Image 1, Image 2, Image 3, Image 4 as sequential keyframes/i);

    // Repair.7: I2V/FLF input trimming must be visible and name excluded media.
    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01", profileId: "minimax-h3/i2v", purpose: "motion", useLLM: false,
        directive: "The ship drifts slowly.",
        references: [
          { key: "a", role: "first-frame", label: "Opening A", approved: true, mediaType: "image", url: "/assets/shots/S-01/takes/a.png" },
          { key: "b", role: "first-frame", label: "Alternate B", approved: true, mediaType: "image", url: "/assets/shots/S-01/takes/b.png" },
          { key: "c", role: "identity", label: "Identity C", approved: true, mediaType: "image", url: "/assets/shots/S-01/takes/c.png" },
        ],
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.references.length, 1);
    assert(result.body.warnings.some((row) => /Not sent: Alternate B, Identity C/i.test(row)), JSON.stringify(result.body.warnings));

    result = await request("/api/prompt/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shotId: "S-01", profileId: "minimax-h3/flf", purpose: "motion", useLLM: false,
        directive: "Bridge the endpoints.",
        references: [{ key: "a", role: "first-frame", label: "Opening only", approved: true, mediaType: "image", url: "/assets/shots/S-01/takes/a.png" }],
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert(result.body.warnings.some((row) => /missing its last-frame input/i.test(row)), JSON.stringify(result.body.warnings));

    // Repair.7: recoverable project deletion must be restorable in the application.
    result = await request("/api/projects/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Trash Restore Test" }),
    });
    assert.strictEqual(result.response.status, 200);
    const trashRestoreSlug = result.body.slug;
    result = await request(`/api/projects/${encodeURIComponent(trashRestoreSlug)}`, { method: "DELETE" });
    assert.strictEqual(result.response.status, 200);
    const trashName = result.body.trashName;
    result = await request("/api/projects");
    assert(result.body.trashed.some((row) => row.trashName === trashName));
    result = await request(`/api/projects/trash/${encodeURIComponent(trashName)}/restore`, { method: "POST" });
    assert.strictEqual(result.response.status, 200);
    result = await request("/api/projects");
    assert(result.body.projects.some((row) => row.slug === result.body.projects.find((row) => row.title === "Trash Restore Test")?.slug));

    // Repair.7: storage roots cannot be changed through the unsafe general config route.
    result = await request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: { projectRoot: "/root" } }),
    });
    assert.strictEqual(result.response.status, 400);
    assert.strictEqual(result.body.code, "WORKSPACE_SETTINGS_ENDPOINT_REQUIRED");
    result = await request("/api/projects");
    assert(result.body.projects.some((project) => project.slug === "smoke-project"));

    result = await request("/");
    assert.strictEqual(result.response.status, 200);
    assert(String(result.body).includes("bootstrap.js"));

    console.log(
      "API smoke test passed guided shot stages, durable automation-run persistence, derived-frame vision review, Project Builder normalization, actionable Guardian updates, planning, agents, single FAL configuration, and legacy-key migration.",
    );
  } finally {
    if (child && !child.killed) child.kill("SIGTERM");
    if (ollamaServer) ollamaServer.close();
    fs.rmSync(TEMP, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  if (child && !child.killed) child.kill("SIGTERM");
  if (ollamaServer) ollamaServer.close();
  fs.rmSync(TEMP, { recursive: true, force: true });
  process.exitCode = 1;
});

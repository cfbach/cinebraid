const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-readiness-feedback-"));
const PROJECTS_ROOT = path.join(TEMP, "projects");
const CONFIG_PATH = path.join(TEMP, "config.json");
let child = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body == null ? null : typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: { ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}), ...(options.headers || {}) },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = text;
        try { data = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, text, data });
      });
    });
    req.once("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`server exited early: ${child.output}`);
    try {
      const response = await request(port, "/api/projects");
      if (response.status === 200) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start");
}

async function stopServer() {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1500))]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

function makeScaleProject() {
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", "cinebraid-sample", "project.json"), "utf8"));
  sample.meta.title = "Readiness Scale Test";
  sample.characters = [];
  sample.props = [];
  sample.vehicles = [];
  sample.audio = [];
  sample.locations = [{
    id: "LOC-SHARED",
    name: "Shared room",
    status: "APPROVED",
    workflowStatus: "APPROVED",
    approvedFile: "LOC-SHARED.png",
    continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "LOC-SHARED.png" }],
    coverageSlots: [],
    candidateFiles: [],
  }];
  sample.scenes = [{ id: "SC-SCALE", title: "Scale scene", whatHappens: "A sequence of described shots." }];
  sample.shots = Array.from({ length: 22 }, (_, index) => {
    const id = `S${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      scene: "SC-SCALE",
      title: `Scale shot ${index + 1}`,
      desc: `A described shot in the same shared room, number ${index + 1}.`,
      dur: 4,
      characters: [],
      codes: index < 2 ? ["LOC-SHARED", "PROP-MISSING"] : ["LOC-SHARED"],
      clips: [],
      keyframes: [],
      creationBrief: { deliveryIntent: "still", frames: [], motionPlan: { audio: { mode: "none" } } },
    };
  });
  return sample;
}

async function main() {
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  fs.cpSync(path.join(ROOT, "projects", "cinebraid-sample"), path.join(PROJECTS_ROOT, "cinebraid-sample"), { recursive: true });
  const scaleDir = path.join(PROJECTS_ROOT, "scale-test");
  fs.mkdirSync(path.join(scaleDir, "plates"), { recursive: true });
  fs.writeFileSync(path.join(scaleDir, "plates", "LOC-SHARED.png"), "placeholder");
  fs.writeFileSync(path.join(scaleDir, "project.json"), JSON.stringify(makeScaleProject(), null, 2));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: "cinebraid-sample",
    assistant: { provider: "none", visionProvider: "none" },
    agents: { enabled: false },
    generation: { fal: { enabled: false, apiKey: "" } },
  }, null, 2));

  const port = await freePort();
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT, CINEBRAID_CONFIG_PATH: CONFIG_PATH },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { child.output += chunk.toString(); });

  try {
    await waitForServer(port);

    let response = await request(port, "/api/project/readiness");
    assert.strictEqual(response.status, 200);
    /* The sample used to open with two readiness issues, described here as
       deliberate teaching material. Neither was: both were the product failing
       to read its own data.

       PROP-PARCEL stores its visual description in `notes`, which Creation
       Studio and the asset compiler both read, but the prompt compiler
       resolved `block || description` and so reported the prop as having no
       canon. SAMPLE-03 declares `duration: 4` and the compiler read only
       `dur`, so it reported the shot as having no explicit duration while
       quietly compiling it as five seconds.

       P-1 repaired both readers, so the sample now opens ready — which is what
       a shipped sample should do. Anything appearing here again is a real
       regression, not a lesson. See tests/intent-loss-safety.js. */
    assert.deepStrictEqual(response.data.issues, [], `the shipped sample must open with no readiness issues, got ${JSON.stringify(response.data.issues.map((row) => row.kind))}`);

    response = await request(port, "/api/projects/switch", { method: "POST", body: { slug: "scale-test" } });
    assert.strictEqual(response.status, 200);
    response = await request(port, "/api/project/readiness");
    assert.strictEqual(response.status, 200);
    const canonRows = response.data.issues.filter((row) => row.kind === "entity-canon" && row.entityId === "LOC-SHARED");
    assert.strictEqual(canonRows.length, 1, "a shared entity problem must be emitted once, not once per shot");
    assert.strictEqual(canonRows[0].shotId, "S01", "the legacy shotId field must retain the first affected shot");
    assert.strictEqual(canonRows[0].shotIds.length, 22, "the deduplicated entity issue must carry every affected shot ID");
    assert.match(canonRows[0].message, /Affects 22 shots\./);
    const unresolvedRows = response.data.issues.filter((row) => row.kind === "unresolved-reference" && row.entityId === "PROP-MISSING");
    assert.strictEqual(unresolvedRows.length, 2, "shot-scoped unresolved references must remain one row per shot");
    assert.strictEqual(response.data.issues.length, 3, "the 22-shot scale fixture must contain one shared entity issue plus two shot-scoped issues");

    const secret = "sk-abcdefghijklmnopqrstuvwxyz1234567890";
    const localPath = "/home/tester/private/project.mov";
    response = await request(port, "/api/test-feedback", {
      method: "POST",
      body: {
        route: `#/shot/S01?token=${secret}`,
        note: `The button was confusing. Key ${secret}. File ${localPath}`,
      },
    });
    assert.strictEqual(response.status, 201, "a provider-free test note must save from any route");
    const serialized = JSON.stringify(response.data);
    assert(!serialized.includes(secret), "test-note output must redact secrets");
    assert(!serialized.includes(localPath), "test-note output must redact absolute paths");
    assert.strictEqual(response.data.record.workflowEmphasis, "manual");
    assert.strictEqual(response.data.record.projectSlug, "scale-test");
    assert.strictEqual(response.data.record.projectSummary.shots, 22);
    assert.strictEqual(response.data.record.projectSummary.entities, 1);
    assert.strictEqual(response.data.record.projectSummary.approvedReferences, 1);
    assert.strictEqual(response.data.record.projectSummary.openReadinessIssues, 3);
    const feedbackFile = path.join(scaleDir, "test-feedback.json");
    assert(fs.existsSync(feedbackFile), "test notes must persist inside the active project");
    const stored = fs.readFileSync(feedbackFile, "utf8");
    assert(!stored.includes(secret) && !stored.includes(localPath), "stored test notes must already be redacted");

    response = await request(port, `/api/test-feedback/${encodeURIComponent(response.data.record.id)}/export?format=markdown`);
    assert.strictEqual(response.status, 200);
    assert.match(response.text, /# CineBraid test note/);
    assert(!response.text.includes(secret) && !response.text.includes(localPath), "test-note export must remain redacted");

    const index = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
    const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
    assert(index.includes("Leave feedback"), "the feedback control must remain available from every route");
    for (const fn of ["openTestNote", "saveTestNote", "copySavedTestNote", "downloadSavedTestNote"]) assert(app.includes(`window.${fn}`), `manual feedback UI is missing ${fn}`);

    console.log("Readiness and feedback suite passed entity-scoped deduplication (22 shots → 1 row), a shipped sample that opens ready, and locally persisted redacted test-note copy/download output.");
  } finally {
    await stopServer();
    fs.rmSync(TEMP, { recursive: true, force: true });
  }
}

main().catch(async (error) => {
  console.error(error.stack || error.message || error);
  await stopServer();
  fs.rmSync(TEMP, { recursive: true, force: true });
  process.exitCode = 1;
});

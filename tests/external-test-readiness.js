const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn, spawnSync } = require("child_process");
const { render, emptyFixture } = require("./render-harness");

const ROOT = path.resolve(__dirname, "..");
const SAMPLE_SLUG = "cinebraid-sample";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function nonLoopbackIPv4() {
  for (const rows of Object.values(os.networkInterfaces())) {
    for (const row of rows || []) {
      if (row.family === "IPv4" && !row.internal && row.address) return row.address;
    }
  }
  return "";
}

function requestStatus(host, port, pathname = "/", timeout = 1000) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host, port, path: pathname, timeout }, (response) => {
      response.resume();
      resolve(response.statusCode || 0);
    });
    request.once("timeout", () => request.destroy(new Error("timeout")));
    request.once("error", reject);
  });
}

async function waitForServer(host, port, child, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      return await requestStatus(host, port, "/", 400);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error("server did not start");
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

function spawnServer(port, args = [], extraEnv = {}) {
  const child = spawn(process.execPath, ["server.js", ...args], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { child.output += chunk.toString(); });
  return child;
}

function testDeclaredRuntimeAndDocs() {
  const pkg = JSON.parse(read("package.json"));
  assert.strictEqual(pkg.engines?.node, ">=18", "package.json must declare Node >=18");
  assert(pkg.scripts?.["start:lan"]?.includes("--lan"), "package.json must expose deliberate LAN startup");
  assert(pkg.scripts?.["check:quick"], "package.json must expose a portable quick check");
  for (const rel of ["README.md", "SETUP.md", "docs/GETTING_STARTED.md"]) {
    const text = read(rel);
    assert(/Node(?:\.js)?\s+18|18 or newer/i.test(text), `${rel} must document Node 18+`);
    assert(/127\.0\.0\.1/.test(text), `${rel} must document the local address`);
    assert(/manual/i.test(text), `${rel} must lead with the manual workflow`);
  }
  const readme = read("README.md");
  const setup = read("SETUP.md");
  assert(/start:lan|--lan/.test(readme) && /start:lan|--lan/.test(setup), "README and SETUP must document deliberate LAN opt-in");
  assert(/local-only|127\.0\.0\.1 only|binds to \*\*127\.0\.0\.1/i.test(`${readme}\n${setup}`), "documentation must state the default local-only posture");
  assert(read("docs/GETTING_STARTED.md").split(/\r?\n/).length < readme.split(/\r?\n/).length, "Getting Started must remain shorter than README");
}

function testUnsupportedNodeFailsClearly() {
  const result = spawnSync(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, CINEBRAID_TEST_NODE_VERSION: "16.20.0", PORT: "0" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.notStrictEqual(result.status, 0, "unsupported Node must exit non-zero");
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  assert.strictEqual(output, "CineBraid requires Node.js 18 or newer; detected 16.20.0.", "unsupported Node must print one clear line");
}

async function testNetworkPosture() {
  const port = await freePort();
  const child = spawnServer(port);
  try {
    assert.strictEqual(await waitForServer("127.0.0.1", port, child), 200, "default server must answer on loopback");
    const lanAddress = nonLoopbackIPv4();
    if (lanAddress) {
      let exposed = false;
      try {
        await requestStatus(lanAddress, port, "/", 500);
        exposed = true;
      } catch (_) {}
      assert.strictEqual(exposed, false, `default server must not answer on ${lanAddress}`);
    } else {
      console.log("External readiness: no non-loopback IPv4 was available; default HOST is still covered by startup source and loopback response.");
    }
    assert(child.output.includes(`http://127.0.0.1:${port}`), "default startup message must name the loopback URL");
  } finally {
    await stopChild(child);
  }

  const lanPort = await freePort();
  const lanChild = spawnServer(lanPort, ["--lan"]);
  try {
    assert.strictEqual(await waitForServer("127.0.0.1", lanPort, lanChild), 200, "LAN opt-in must still answer locally");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(/WARNING: LAN mode exposes CineBraid/i.test(lanChild.output), "LAN startup must print an exposure warning");
  } finally {
    await stopChild(lanChild);
  }
}

async function testZeroProjectFirstRun() {
  const rendered = await render("#/production", emptyFixture(), {
    fetch: async (url, options, respond) => {
      if (url === "/api/project") return respond({ error: "No active project" }, 404);
      if (url === "/api/projects") return respond({ active: "", projects: [{ slug: SAMPLE_SLUG, title: "CineBraid Sample — The Blue Parcel" }] });
      return null;
    },
  });
  assert(rendered.html.includes("WELCOME TO CINEBRAID"), "zero-project startup must render the first-run state");
  assert(rendered.html.includes("Create a project"), "first-run state must offer project creation");
  assert(rendered.html.includes("Open CineBraid Sample"), "first-run state must offer the sample when present");
  assert(rendered.html.includes("AI and in-app generation are optional"), "first-run state must explain the manual-first product");
}

function disabledAgentStatus() {
  const disabled = { ready: false, label: "Disabled", provider: "none", model: "", message: "Disabled", action: "" };
  return {
    enabled: false,
    manualMode: true,
    active: 0,
    queued: 0,
    maxConcurrent: 1,
    capabilities: Object.fromEntries(["text", "verifier", "vision", "embedding", "technical"].map((key) => [key, disabled])),
    agents: [],
    runs: [],
    index: { ready: false, stale: true },
  };
}

function sampleScan(project) {
  const dataUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='36'%3E%3Crect width='64' height='36' fill='%23414b55'/%3E%3C/svg%3E";
  const named = (name) => ({ name, url: dataUrl });
  return {
    anchors: [named("CHAR-COURIER-FRONT.png"), named("CHAR-COURIER-PROFILE.png")],
    plates: [named("LOC-PLATFORM-MASTER.png"), named("LOC-PLATFORM-REVERSE.png")],
    props: [named("PROP-PARCEL-CLOSED.png"), named("PROP-PARCEL-OPEN.png")],
    vehicles: [], audio: [], media: [],
    shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, {
      takes: [named(`${shot.id === "SAMPLE-01" ? "SAMPLE-01-ARRIVAL" : shot.id === "SAMPLE-02" ? "SAMPLE-02-BENCH" : "SAMPLE-03-OPEN"}.png`)],
      locked: [],
    }])),
  };
}

async function testSampleCompletesProviderFree() {
  const sample = JSON.parse(read(`projects/${SAMPLE_SLUG}/project.json`));
  const config = JSON.parse(read("data/config.json"));
  assert.strictEqual(sample.meta?.workflowEmphasis, "manual", "sample must open manual-first");
  assert.strictEqual(config.activeProject, SAMPLE_SLUG, "fresh release must select the sample");
  assert.strictEqual(config.assistant?.provider, "none", "sample configuration must not require a text provider");
  assert.strictEqual(config.assistant?.visionProvider, "none", "sample configuration must not require a vision provider");
  assert.strictEqual(config.generation?.fal?.enabled, false, "sample configuration must keep FAL disabled");

  const requested = [];
  const rendered = await render("#/shot/SAMPLE-03", sample, {
    scan: sampleScan(sample),
    agentStatus: disabledAgentStatus(),
    fetch: async (url) => { requested.push(String(url)); return null; },
  });
  const context = rendered.context;
  for (const [shotId, file] of [["SAMPLE-01", "SAMPLE-01-ARRIVAL.png"], ["SAMPLE-02", "SAMPLE-02-BENCH.png"]]) {
    rendered.gesture.act(() => context.markGuidedStillFinal(shotId, file));
  }
  context.approveTake("SAMPLE-03", "SAMPLE-03-OPEN.png");
  context.document.getElementById("approve-target").value = "frame:frame-a";
  context.document.getElementById("approve-name").value = "SAMPLE-03-OPEN.png";
  await rendered.gesture.act(() => context.confirmApproveTake());
  rendered.gesture.act(() => context.markGuidedStillFinal("SAMPLE-03", "SAMPLE-03-OPEN.png"));

  assert(vm.runInContext("P.shots.every((shot) => !!shot.finalStillFile)", context), "every sample shot must be finalizable with existing media");
  assert(vm.runInContext("P.shots.every((shot) => [\"APPROVED\", \"LOCKED\"].includes(shot.workflowStatus))", context), "sample completion must record approved workflow status");
  const assistedCalls = requested.filter((url) => /\/api\/(?:prompt\/(?:compile|asset-compile)|generation|assistant|agents\/run|automation\/runs\/start)/.test(url));
  assert.deepStrictEqual(assistedCalls, [], `provider-free completion made assisted calls: ${assistedCalls.join(", ")}`);
}

function testSanitizedContents() {
  const projects = fs.readdirSync(path.join(ROOT, "projects"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepStrictEqual(projects, [SAMPLE_SLUG], "source release must contain only the designated sample project");
  const sample = JSON.parse(read(`projects/${SAMPLE_SLUG}/project.json`));
  assert.strictEqual(sample.meta?.title, "CineBraid Sample — The Blue Parcel");
  assert.strictEqual((sample.characters || []).length, 1);
  assert.strictEqual((sample.locations || []).length, 1);
  assert.strictEqual((sample.props || []).length, 1);
  assert.strictEqual((sample.shots || []).length, 3);
}

async function main() {
  testDeclaredRuntimeAndDocs();
  testUnsupportedNodeFailsClearly();
  testSanitizedContents();
  await testZeroProjectFirstRun();
  await testSampleCompletesProviderFree();
  await testNetworkPosture();
  console.log("External test readiness passed sanitized packaging, Node 18 declaration and startup guard, loopback-by-default networking, deliberate LAN warning, first-run guidance, and provider-free sample completion.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

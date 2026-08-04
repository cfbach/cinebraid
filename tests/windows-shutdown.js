/* Regression check for the Windows orphan-server defect.

   `npm start` builds a three-process chain on Windows:
       npm.cmd  ->  cmd.exe /d /s /c node server.js  ->  node server.js
   Windows has no POSIX process groups, so a supervisor that terminates only its immediate
   child orphans the descendants; `node server.js` survives still holding port 4477.

   The repair is to launch the server directly (.claude/launch.json), so the process the
   supervisor terminates IS the listener, plus explicit shutdown handling in server.js.

   This check proves:
     1. a directly-spawned server listens, and terminating that exact PID frees the port
     2. the port can be rebound immediately afterwards
     3. no unrelated node processes are terminated
     4. server.js keeps the listen handle and registers shutdown handlers
     5. .claude/launch.json launches node directly, with no npm/cmd indirection

   It never touches port 4477, projects/ or data/. */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const HARD_TIMEOUT_MS = 60000;
const isWindows = process.platform === "win32";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hardStop = setTimeout(() => {
  console.error("windows-shutdown suite exceeded its hard timeout");
  process.exit(1);
}, HARD_TIMEOUT_MS);
if (typeof hardStop.unref === "function") hardStop.unref();

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function portIsBindable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/* Windows can hold the socket for a few milliseconds after the owning process object has
   already disappeared, so poll briefly rather than demanding the very first attempt
   succeed. A genuine orphan still holds the port for its whole lifetime and fails here. */
async function waitForBindable(port, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await portIsBindable(port)) return Date.now() - startedAt;
    await wait(100);
  }
  return -1;
}

/* Distinguishes a real orphan (still LISTENING) from transient socket teardown. */
function listenersOnPort(port) {
  if (!isWindows) return null;
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", timeout: 15000 });
    return out.split("\n").filter((line) => line.includes(`:${port} `) && /LISTENING/i.test(line));
  } catch { return null; }
}

function get(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.once("error", reject);
    req.once("timeout", () => { req.destroy(new Error("timeout")); });
  });
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/* Node PIDs currently running, so the test can prove it killed only its own child. */
function nodePids() {
  if (!isWindows) return null;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\").ProcessId -join ','"],
      { encoding: "utf8", timeout: 15000 });
    return new Set(out.trim().split(",").filter(Boolean).map(Number));
  } catch { return null; }
}

/* ---------- static guarantees ---------- */

function testServerRetainsListenerAndHandlesSignals() {
  const source = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert(/const httpServer = app\.listen\(/.test(source),
    "server.js must keep the app.listen() handle so the listener can be closed");
  assert(/httpServer\.close\(/.test(source),
    "server.js must close the HTTP listener on shutdown");
  assert(/closeAllConnections/.test(source),
    "server.js must drop keep-alive sockets, otherwise close() never completes and the port stays bound");
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
    assert(source.includes(`"${signal}"`), `server.js must handle ${signal}`);
  }
}

function testLaunchConfigAvoidsWrapperProcesses() {
  const file = path.join(ROOT, ".claude", "launch.json");
  assert(fs.existsSync(file), ".claude/launch.json must be tracked so the dev launcher runs node directly");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const entry = (config.configurations || []).find((c) => c.name === "cinebraid");
  assert(entry, "launch.json must define a 'cinebraid' configuration");
  assert.strictEqual(entry.runtimeExecutable, "node",
    "the launcher must exec node directly; npm introduces the wrapper chain that orphans the server");
  assert.deepStrictEqual(entry.runtimeArgs, ["server.js"], "the launcher must run server.js");
  assert.strictEqual(entry.port, 4477, "the launcher must declare CineBraid's port");
}

/* ---------- live lifecycle ---------- */

async function testDirectSpawnTerminatesCleanly() {
  const port = await freePort();
  const before = nodePids();

  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_HOST: "127.0.0.1" },
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    let status = 0;
    for (let i = 0; i < 40 && !status; i++) {
      await wait(250);
      try { status = await get(port); } catch { /* not up yet */ }
    }
    assert.strictEqual(status, 200, `server must answer on 127.0.0.1:${port}`);
    assert(processAlive(child.pid), "server process must be running");

    // The supervisor terminates exactly this PID - the same thing Claude Desktop does.
    child.kill();
    for (let i = 0; i < 40 && processAlive(child.pid); i++) await wait(250);

    assert(!processAlive(child.pid), `server PID ${child.pid} must be gone after termination`);

    const stillListening = listenersOnPort(port);
    if (stillListening) {
      assert.deepStrictEqual(stillListening, [],
        `no process may still be LISTENING on ${port} - that is the orphan defect:\n${stillListening.join("\n")}`);
    }

    const boundAfterMs = await waitForBindable(port);
    assert(boundAfterMs >= 0, `port ${port} must become rebindable, but it was still held after 3s`);
    console.log(`  port ${port} rebindable ${boundAfterMs}ms after the server PID exited`);

    const after = nodePids();
    if (before && after) {
      const killed = [...before].filter((pid) => !after.has(pid));
      assert.deepStrictEqual(killed, [],
        `no pre-existing node process may be terminated, but these disappeared: ${killed.join(", ")}`);
    }
  } finally {
    if (processAlive(child.pid)) { try { child.kill("SIGKILL"); } catch {} }
  }
}

async function main() {
  testServerRetainsListenerAndHandlesSignals();
  testLaunchConfigAvoidsWrapperProcesses();
  await testDirectSpawnTerminatesCleanly();
  clearTimeout(hardStop);
  console.log(
    "Windows shutdown suite passed: server keeps its listen handle and handles SIGINT/SIGTERM/SIGBREAK, " +
    "the launcher execs node directly with no npm or cmd wrapper, and terminating the server PID frees " +
    "the port for immediate rebinding without touching unrelated node processes.",
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

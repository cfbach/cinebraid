/* Project-switch safety.
 *
 * Covers the private-launch blockers from the 2026-08-04 UX review:
 *   F-03  a switch to an unreadable project returned 200, changed the server's active project
 *         and left the interface rendering the previous one, with no visible error.
 *   F-04  the resulting failure screen printed a raw parser message, the wrong file path, never
 *         named the project, still showed a green "Saved" indicator, and collapsed the project
 *         switcher to an unlabelled "—".
 *
 * The switch must be atomic at the application-state level: a project that cannot be read and
 * validated never becomes active, so a later edit can never land in the failed target.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-switch-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const A = "switch-a";
const B = "switch-b";
const fileFor = (slug) => path.join(PROJECTS_ROOT, slug, "project.json");

let child = null;
let base = "";
let output = "";

function projectFixture(title) {
  return {
    meta: { title, format: "Test", version: "v1", hubVersion: "v5.5.0", aiPolicy: "project-default" },
    qcChecklist: [],
    scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [{ id: "S-01", scene: "SC-01", title: "Shot one", dur: 5, workflowStatus: "DRAFT", keyframes: [], clips: [] }],
    characters: [],
    locations: [],
    props: [],
    vehicles: [],
    audio: [],
    mediaAssets: [],
    jobs: [],
    agentRuns: [],
    decisions: [],
    sessions: [],
  };
}
function writeProjectFile(slug, contents) {
  fs.mkdirSync(path.dirname(fileFor(slug)), { recursive: true });
  fs.writeFileSync(fileFor(slug), contents);
}
function hashOf(slug) {
  return crypto.createHash("sha256").update(fs.readFileSync(fileFor(slug))).digest("hex");
}
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
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
function postJson(url, payload) {
  return request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const result = await fetch(base + "/api/me");
      if (result.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`Server did not start. Output:\n${output}`);
}
function setActiveProjectDirectly(slug) {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  config.activeProject = slug;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
function activeProject() {
  return request("/api/projects").then((result) => result.body.active);
}

/* ---------- server: the switch itself ---------- */
async function serverChecks() {
  assert.strictEqual(await activeProject(), A, "the fixture must start on project A");
  let result = await request("/api/project");
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.body.meta.title, "Project A");

  /* 1. A valid switch still works, and reports which project it opened. */
  result = await postJson("/api/projects/switch", { slug: B });
  assert.strictEqual(result.response.status, 200, "a valid switch must still succeed");
  assert.strictEqual(result.body.slug, B);
  assert.strictEqual(await activeProject(), B);
  assert.strictEqual((await request("/api/project")).body.meta.title, "Project B");
  await postJson("/api/projects/switch", { slug: A });

  /* 2. A UTF-8 BOM is what PowerShell's Out-File and Notepad produce on Windows. It must not
        be the difference between a readable and an unreadable project. */
  writeProjectFile(B, "\uFEFF" + JSON.stringify(projectFixture("Project B"), null, 2));
  result = await postJson("/api/projects/switch", { slug: B });
  assert.strictEqual(result.response.status, 200, "a BOM-prefixed project must open normally");
  assert.strictEqual(await activeProject(), B);
  result = await request("/api/project");
  assert.strictEqual(result.response.status, 200, "a BOM-prefixed project must be served, not 500");
  assert.strictEqual(result.body.meta.title, "Project B");
  await postJson("/api/projects/switch", { slug: A });

  /* 3. and 4. A failed switch must change nothing: not the active project, not either file. */
  const invalidCases = [
    {
      label: "syntactically invalid",
      contents: '{ "meta": { "title": "Project B" ',
      reason: "invalid-json",
    },
    {
      label: "structurally invalid",
      contents: JSON.stringify({ meta: { title: "Project B" }, scenes: "not-an-array", shots: [] }, null, 2),
      reason: "invalid-structure",
    },
  ];
  for (const testCase of invalidCases) {
    writeProjectFile(B, testCase.contents);
    const beforeA = hashOf(A);
    const beforeB = hashOf(B);

    result = await postJson("/api/projects/switch", { slug: B });
    assert.strictEqual(
      result.response.status,
      422,
      `a ${testCase.label} project must be refused with a non-success status`,
    );
    assert.strictEqual(result.body.projectFailure.reason, testCase.reason);

    /* The error names the project and the real file path — never the old "data/project.json". */
    assert.match(result.body.error, /Project B|switch-b/, "the refusal must identify the project");
    assert.strictEqual(result.body.projectFailure.path, fileFor(B), "the refusal must give the real path");
    assert.doesNotMatch(result.body.error, /data\/project\.json/, "the wrong path must not come back");
    assert.strictEqual(result.body.projectFailure.slug, B);

    /* The server's active project did not move, and the previous project still serves. */
    assert.strictEqual(await activeProject(), A, `${testCase.label}: the active project must not move`);
    result = await request("/api/project");
    assert.strictEqual(result.response.status, 200, `${testCase.label}: project A must still load`);
    assert.strictEqual(result.body.meta.title, "Project A");

    assert.strictEqual(hashOf(A), beforeA, `${testCase.label}: project A must be untouched`);
    assert.strictEqual(hashOf(B), beforeB, `${testCase.label}: project B must be untouched`);
  }

  /* 5. A later edit after a failed switch lands in A, never in the failed target B. */
  const bBeforeEdit = hashOf(B);
  const edited = projectFixture("Project A edited after a failed switch");
  result = await request(`/api/projects/${A}/project`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(edited),
  });
  assert.strictEqual(result.response.status, 200, "editing the still-active project must work");
  assert.strictEqual(
    JSON.parse(fs.readFileSync(fileFor(A), "utf8")).meta.title,
    "Project A edited after a failed switch",
    "the edit must land in project A",
  );
  assert.strictEqual(hashOf(B), bBeforeEdit, "the edit must not touch the failed target project");

  /* 6. If the active project is corrupted outside CineBraid, the read fails with a payload that
        names the project and the real path so the interface can explain it. */
  setActiveProjectDirectly(B);
  result = await request("/api/project");
  assert.ok(!result.response.ok, "a corrupt active project must not be served as a success");
  assert.strictEqual(result.response.status, 422);
  assert.strictEqual(result.body.projectFailure.path, fileFor(B));
  assert.strictEqual(result.body.projectFailure.slug, B);
  assert.doesNotMatch(result.body.error, /data\/project\.json/);
  setActiveProjectDirectly(A);

  /* 7. A missing project is still a 404, not a 422. */
  result = await postJson("/api/projects/switch", { slug: "no-such-project" });
  assert.strictEqual(result.response.status, 404);
  assert.strictEqual(await activeProject(), A);
}

/* ---------- interface: recovery, the dialog, and the indicators ---------- */
function failurePayload(slug = B, title = "Project B") {
  return {
    error: `CineBraid could not open “${title}” because its project file is not valid JSON. The file is untouched and the project you were in is still open.`,
    projectFailure: {
      slug,
      title,
      path: `C:\\CineBraid\\projects\\${slug}\\project.json`,
      reason: "invalid-json",
      detail: "Unexpected end of JSON input",
      issues: [],
    },
  };
}

async function interfaceChecks() {
  const { render, buildFixture } = require("./render-harness");

  /* A failed load must not look like a rendering bug, must name the project and the real path,
     must keep the project switcher labelled and clickable, and must never show "Saved". */
  const failed = await render("#/production", buildFixture(), {
    allowRenderError: true,
    fetch: (url, options, response) =>
      url === "/api/project" ? response(failurePayload(), 422) : null,
  });
  const main = failed.map.get("main").innerHTML;
  assert.match(main, /could not open/i, "the failure screen must explain that the project could not be opened");
  assert.match(main, /Project B/, "the failure screen must name the project that failed");
  assert.match(main, /projects\\switch-b\\project\.json/, "the failure screen must print the real project path");
  assert.doesNotMatch(main, /data\/project\.json/, "the failure screen must not print the wrong path");
  assert.doesNotMatch(main, /could not render/i, "a bad project file is not a rendering failure");
  assert.match(main, /openProjectSwitcher\(\)/, "the failure screen must offer a route to another project");

  const saveState = failed.map.get("save-state");
  assert.strictEqual(saveState.dataset.state, "error", "a failed load must not sit in a saved state");
  assert.notStrictEqual(
    saveState.querySelector("span:last-child").textContent,
    "Saved",
    "a failed load must never display Saved",
  );

  const switcher = failed.map.get("project-title");
  assert.strictEqual(switcher.textContent, "Projects", "the project switcher must stay labelled during a failure");
  assert.notStrictEqual(switcher.textContent, "—", "the project switcher must not collapse to a bare dash");
  assert.strictEqual(typeof switcher.onclick, "function", "the project switcher must stay clickable during a failure");
  assert.match(
    String(switcher["aria-label"] || ""),
    /project switcher/i,
    "the project switcher must keep an accessible name during a failure",
  );

  /* A refused switch keeps the dialog open, explains the refusal in place, and leaves the
     previously open project on screen. */
  const fixture = buildFixture();
  const calls = [];
  let mode = "ok";
  let projectReadsToFail = 0;
  const open = await render("#/production", fixture, {
    fetch: (url, options, response) => {
      if (url === "/api/projects/switch" && options.method === "POST") {
        calls.push(JSON.parse(options.body).slug);
        if (mode === "refuse") return response(failurePayload(), 422);
        return response({ ok: true, slug: JSON.parse(options.body).slug });
      }
      if (url === "/api/project" && projectReadsToFail > 0) {
        projectReadsToFail -= 1;
        return response(failurePayload(), 422);
      }
      if (url === "/api/projects")
        return response({
          active: "fixture",
          projects: [
            { slug: "fixture", title: fixture.meta.title, format: "" },
            { slug: B, title: "Project B", format: "" },
          ],
        });
      return null;
    },
  });
  const openedTitle = open.map.get("project-title").textContent;
  assert.strictEqual(openedTitle, fixture.meta.title, "the fixture project must be open before switching");

  await open.context.openProjectSwitcher();
  assert.match(
    open.map.get("modal").innerHTML,
    /project-switcher-error/,
    "the dialog must carry a slot for explaining a refused switch",
  );

  mode = "refuse";
  await open.context.switchProject(B);
  const errorSlot = open.map.get("project-switcher-error");
  assert.strictEqual(errorSlot.hidden, false, "a refused switch must show an error in the dialog");
  assert.match(errorSlot.innerHTML, /Project B/, "the dialog error must identify the project that failed");
  assert.match(errorSlot.innerHTML, /projects\\switch-b\\project\.json/, "the dialog error must give the real project path");
  assert.match(
    open.map.get("modal").innerHTML,
    /project-switcher-modal/,
    "the Projects dialog must stay open after a refused switch",
  );
  assert.strictEqual(
    open.map.get("project-title").textContent,
    openedTitle,
    "the previously open project must stay visible after a refused switch",
  );

  /* Belt and braces: if the switch is accepted but the load still fails, the interface puts the
     previous project back rather than leaving the server pointing somewhere else. */
  mode = "ok";
  calls.length = 0;
  projectReadsToFail = 1;
  await open.context.switchProject(B);
  assert.deepStrictEqual(
    calls,
    [B, "fixture"],
    "a post-switch load failure must roll the active project back to the previous one",
  );
  assert.strictEqual(
    open.map.get("project-title").textContent,
    openedTitle,
    "the previously open project must be visible again after a rollback",
  );
  assert.strictEqual(open.map.get("project-switcher-error").hidden, false, "the rollback must still explain what failed");

  /* The shipped markup must not promise a saved project before one has been loaded. */
  const indexHtml = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  assert.doesNotMatch(indexHtml, /<span>Saved<\/span>/, "the resting markup must not claim a project is saved");
  assert.doesNotMatch(
    indexHtml,
    /id="project-title"[^>]*>—</,
    "the project switcher must not ship as a bare dash",
  );
  assert.match(indexHtml, /id="project-title"[^>]*aria-label=/, "the project switcher must ship with an accessible name");
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error("project-switch-safety timed out");
    if (child) child.kill();
    process.exit(1);
  }, 90000);
  watchdog.unref?.();
  try {
    fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
    writeProjectFile(A, JSON.stringify(projectFixture("Project A"), null, 2));
    writeProjectFile(B, JSON.stringify(projectFixture("Project B"), null, 2));
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ activeProject: A }, null, 2));

    const port = await getFreePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        CINEBRAID_CONFIG_PATH: CONFIG_PATH,
        CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    await waitForServer();

    await serverChecks();
    await interfaceChecks();

    console.log("Project-switch safety passed: BOM-tolerant reads, validated atomic switching, refusal without state change, no wrong-project write, and a named recovery state with a reachable project switcher.");
  } finally {
    clearTimeout(watchdog);
    if (child) child.kill();
    try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch {}
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    if (output) console.error(output);
    process.exitCode = 1;
  });

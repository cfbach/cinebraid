/* CineBraid active-project containment.
 *
 * PROJECT_DIR() is the root that every path-containment check in the codebase
 * resolves against — /assets/*, the media routes, the reference resolvers, the
 * upload paths. It is derived from activeSlug(), which is derived from
 * config.activeProject, and that is the one project reference that never passed
 * through a route: data/config.json can be hand-edited and PUT /api/config merges
 * what it is given.
 *
 * So a poisoned activeProject does not TRIP a containment check. It MOVES the
 * boundary, and every check downstream then dutifully confirms that a file is inside
 * the relocated root. That is why this suite asserts containment of the resolved
 * directory rather than the shape of the string.
 *
 * Everything here drives the real server, because the defect lives in the real
 * resolution path and a unit test of cleanProjectSlug in isolation would have passed
 * before the fix: cleanProjectSlug ACCEPTS ".." — it is its own basename.
 */
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-containment-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
/* The projects root sits one level down, so ".." has somewhere real to escape TO. */
const PROJECTS_ROOT = path.join(TEMP, "projects");
/* A sibling of the projects root whose name starts with the same characters. A
   containment check written with startsWith() treats this as inside. */
const PREFIX_SIBLING = path.join(TEMP, "projects-decoy");

const B = String.fromCharCode(92);
let child = null;
let base = "";
let output = "";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
async function request(url) {
  const response = await fetch(base + url);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
function writeProject(dir, title) {
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({
    meta: { title, format: "Test", version: "v1", hubVersion: "v6.0.0", schemaVersion: "6.6", aiPolicy: "project-default" },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [], audio: [],
    mediaAssets: [], scenes: [], shots: [], agentRuns: [], decisions: [], sessions: [], finishJobs: [],
  }, null, 2));
  return dir;
}
function setActiveProject(value) {
  const config = { activeProject: value, assistant: { provider: "ollama", visionProvider: "ollama" } };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/* Every legitimate slug the product can produce, and every escape shape worth
   attacking. `expect` is the slug that must be served: a real project name when the
   value is legitimate, or null meaning "anything but the poisoned value". */
const MATRIX = [
  { label: "plain slug", value: "real-project", expect: "real-project" },
  { label: "hyphenated", value: "another-real-project", expect: "another-real-project" },
  { label: "underscored", value: "under_score_project", expect: "under_score_project" },
  { label: "dotted name", value: "a.b.project", expect: "a.b.project" },
  { label: "prefix of another project", value: "real", expect: "real" },
  { label: "current directory", value: ".", expect: null },
  { label: "parent directory", value: "..", expect: null },
  { label: "posix traversal", value: "../foo", expect: null },
  { label: "windows traversal", value: ".." + B + "foo", expect: null },
  { label: "double posix traversal", value: "../../foo", expect: null },
  { label: "double windows traversal", value: ".." + B + ".." + B + "foo", expect: null },
  { label: "mixed separators", value: ".." + B + "../foo", expect: null },
  { label: "escape to the prefix sibling", value: "../projects-decoy", expect: null },
  { label: "windows escape to the prefix sibling", value: ".." + B + "projects-decoy", expect: null },
  { label: "leading slash", value: "/real-project", expect: null },
  { label: "leading backslash", value: B + "real-project", expect: null },
  { label: "repeated separators", value: "a//b", expect: null },
  { label: "windows drive absolute", value: "C:" + B + "Windows", expect: null },
  { label: "windows drive absolute, forward slash", value: "C:/Windows", expect: null },
  { label: "UNC share", value: B + B + "server" + B + "share", expect: null },
  { label: "UNC share, forward slash", value: "//server/share", expect: null },
  { label: "posix absolute", value: "/tmp/foo", expect: null },
  { label: "dot run", value: "...", expect: null },
  { label: "long dot run", value: "....", expect: null },
  { label: "trailing separator", value: "real-project/", expect: null },
  { label: "trailing backslash", value: "real-project" + B, expect: null },
  { label: "embedded null-ish text", value: "real-project%00", expect: null },
  { label: "percent-encoded traversal", value: "%2e%2e", expect: null },
  { label: "percent-encoded separator", value: "..%2f..", expect: null },
  { label: "fullwidth solidus", value: ".." + String.fromCharCode(0xFF0F) + "foo", expect: null },
  { label: "empty", value: "", expect: null },
  /* Windows-specific shapes. None of these escapes — each resolves to a one-segment
     child that does not exist — but they are pinned here so a future rewrite of the
     containment rule cannot start accepting one that does. */
  { label: "DOS device NUL", value: "NUL", expect: null },
  { label: "DOS device CON", value: "CON", expect: null },
  { label: "DOS device COM1", value: "COM1", expect: null },
  { label: "alternate data stream", value: "real-project::$DATA", expect: null },
  { label: "drive-relative", value: "C:", expect: null },
  { label: "8.3 short name", value: "PROGRA~1", expect: null },
  { label: "trailing dot", value: "real-project.", expect: null },
  { label: "home shorthand", value: "~", expect: null },
  /* cleanProjectSlug trims, so a stray space around a real name still opens it. That
     is normalisation rather than traversal, and it stays contained. */
  { label: "surrounding whitespace on a real slug", value: "  real-project  ", expect: "real-project" },
];

async function main() {
  /* Inside the projects root. */
  writeProject(path.join(PROJECTS_ROOT, "real-project"), "Real Project");
  writeProject(path.join(PROJECTS_ROOT, "another-real-project"), "Another Real Project");
  writeProject(path.join(PROJECTS_ROOT, "under_score_project"), "Underscore Project");
  writeProject(path.join(PROJECTS_ROOT, "a.b.project"), "Dotted Project");
  /* "real" is a prefix of "real-project": a lookup that compares by prefix rather
     than by path component will serve the wrong one. */
  writeProject(path.join(PROJECTS_ROOT, "real"), "Prefix Project");
  fs.writeFileSync(path.join(PROJECTS_ROOT, "real-project", "docs", "INSIDE.md"), "# inside");

  /* OUTSIDE the projects root, and reachable by exactly one "..". Both are complete,
     openable projects, so nothing but containment stops them being served. */
  writeProject(TEMP, "ESCAPED PARENT");
  fs.writeFileSync(path.join(TEMP, "docs", "ESCAPED.md"), "# escaped");
  writeProject(PREFIX_SIBLING, "ESCAPED PREFIX SIBLING");
  fs.writeFileSync(path.join(PREFIX_SIBLING, "docs", "ESCAPED-SIBLING.md"), "# escaped sibling");

  const validSlugs = ["real-project", "another-real-project", "under_score_project", "a.b.project", "real"];

  setActiveProject("real-project");
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 10000;
  for (;;) {
    try { if ((await fetch(base + "/api/me")).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  /* ---- 1. the traversal matrix, against the real resolution path ---- */
  for (const testCase of MATRIX) {
    setActiveProject(testCase.value);

    const projects = await request("/api/projects");
    assert.strictEqual(projects.response.status, 200, `${testCase.label}: /api/projects failed`);
    const active = projects.body.active;

    /* Whatever is served must be a real project inside the projects root. */
    assert(
      active === null || validSlugs.includes(active),
      `${testCase.label} (${JSON.stringify(testCase.value)}): active slug "${active}" is not a project inside projectsRoot`,
    );
    if (testCase.expect)
      assert.strictEqual(active, testCase.expect, `${testCase.label}: a legitimate slug must be served unchanged`);
    else
      assert.notStrictEqual(
        active, testCase.value,
        `${testCase.label}: ${JSON.stringify(testCase.value)} was accepted as an active project`,
      );

    /* PROJECT_DIR() itself: /api/docs lists PROJECT_DIR()/docs. If the root moved,
       the escaped document appears here. This is the assertion that would have
       failed before the fix. */
    const docs = await request("/api/docs");
    const listed = Array.isArray(docs.body) ? docs.body : [];
    for (const escaped of ["ESCAPED.md", "ESCAPED-SIBLING.md"])
      assert(
        !listed.includes(escaped),
        `${testCase.label} (${JSON.stringify(testCase.value)}): PROJECT_DIR escaped projectsRoot — /api/docs listed ${escaped}`,
      );

    /* And the project document served must never be one of the outside decoys. */
    const project = await request("/api/project");
    if (project.response.status === 200) {
      const title = project.body?.meta?.title || "";
      assert(
        !String(title).startsWith("ESCAPED"),
        `${testCase.label} (${JSON.stringify(testCase.value)}): served the outside project "${title}"`,
      );
    }
  }

  /* ---- 2. the legitimate case still works end to end ---- */
  setActiveProject("real-project");
  const docs = await request("/api/docs");
  assert(
    (Array.isArray(docs.body) ? docs.body : []).includes("INSIDE.md"),
    "a legitimate active project must still resolve to its own directory",
  );
  const project = await request("/api/project");
  assert.strictEqual(project.body?.meta?.title, "Real Project");

  /* ---- 3. switching between real projects is unaffected ---- */
  for (const slug of validSlugs) {
    setActiveProject(slug);
    const result = await request("/api/projects");
    assert.strictEqual(result.body.active, slug, `switching to ${slug} must be preserved byte-for-byte`);
  }

  /* ---- 4. a poisoned value falls back rather than failing closed ----
     Refusing to open ANY project would turn a bad config value into an outage. */
  setActiveProject("..");
  const fallback = await request("/api/projects");
  assert(
    validSlugs.includes(fallback.body.active),
    "a rejected active project must fall back to a real project, not to nothing",
  );

  console.log(
    `Active-project containment suite passed: ${MATRIX.length} slug shapes resolved, `
    + "every accepted value stays a direct child of the projects root, and no traversal reached the parent or a prefix sibling.",
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    if (output) console.error(`--- server output ---\n${output}`);
    process.exitCode = 1;
  })
  .finally(() => {
    child?.kill();
    fs.rmSync(TEMP, { recursive: true, force: true });
  });

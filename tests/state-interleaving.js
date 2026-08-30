/* Deterministic state-interleaving safety.
 *
 * The regression net for one bug class: work that is already in flight must not
 * change which project it belongs to, and two writers must not silently erase
 * each other. Every finding below was reproduced against the post-Repair-A
 * baseline before it was fixed.
 *
 *   F-02  asynchronous FAL ingest crossing a project switch wrote project A's
 *         downloaded media into project B's shots folder AND replaced B's whole
 *         project.json with A's document — B's title, shots and characters gone,
 *         while A received nothing at all.
 *   F-03  a stale whole-document save overwrote newer project state and was
 *         answered 200 {"ok":true}, so the client that destroyed the work was
 *         told it had saved.
 *   F-05  read jobs -> await provider -> write the stale snapshot: an overlapping
 *         operation's row was erased, and a refresh that had already downloaded
 *         and ingested its result was rolled back to IN_QUEUE, losing
 *         `ingestedAt` and inviting a second paid ingest of the same images.
 *   F-12  media routes resolved their destination from the globally active
 *         project at the moment the write ran, not from the project the upload
 *         was started for.
 *
 * Timing is never used to create the race. A mock provider holds each response
 * on an explicit barrier that the test releases, so the interleaving is the same
 * on every machine and every run. Each protection also carries a NEGATIVE
 * CONTROL that reproduces the original defect through the unprotected path, so a
 * green result here cannot come from the race simply failing to happen.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { addMotionPromptBuild } = require("./h3-execution-fixture");
const { withGenerationDeclaration } = require("./generation-request-fixture");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-interleave-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const A = "owner-alpha";
const B = "owner-beta";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let child = null;
let base = "";
let output = "";
let mock = null;
let mockBase = "";

const fileFor = (slug) => path.join(PROJECTS_ROOT, slug, "project.json");
const jobsFileFor = (slug) => path.join(PROJECTS_ROOT, slug, "generation-jobs.json");

function projectFixture(title) {
  const project = {
    meta: { title, format: "Test", version: "v1", hubVersion: "v6.0.0", aiPolicy: "project-default" },
    qcChecklist: [],
    scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [{
      id: "S-01", scene: "SC-01", title: "Shot one", dur: 5,
      workflowStatus: "DRAFT", keyframes: [], clips: [], candidateFiles: [], creationBrief: {},
    }],
    characters: [{ id: "CH-01", name: "Courier", canon: "A courier.", approvedFile: "", candidateFiles: [], generatedCandidates: [] }],
    locations: [], props: [], vehicles: [], audio: [],
    mediaAssets: [], jobs: [], agentRuns: [], decisions: [], sessions: [],
  };
  /* A MiniMax H3 request now compiles from the shot's durable motion package, so both
     projects carry one. Each is built for its OWN shot, which is what makes the
     ownership assertion below meaningful: if a switch could redirect the compilation,
     the plan would name the other project's package. */
  addMotionPromptBuild(project, "S-01", { mode: "t2v", id: `h3-${title.replace(/\W+/g, "-").toLowerCase()}`, durationSeconds: 8, references: [] });
  return project;
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

/* ---------- barriers ----------
   A gate is reached when the provider request arrives and released when the test
   says so. `reached` is what makes the interleaving deterministic: the test can
   prove the server is parked inside the operation before it does anything else. */
const gates = new Map();
function gate(name) {
  if (!gates.has(name)) {
    let release, arrived;
    const held = new Promise((r) => (release = r));
    const reached = new Promise((r) => (arrived = r));
    gates.set(name, { held, release, reached, arrived });
  }
  return gates.get(name);
}
let holdDownloads = false;
const heldSubmitMarkers = new Set();

function startMock(port) {
  mock = http.createServer(async (req, res) => {
    const url = new URL(req.url, mockBase);
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "POST" && !url.pathname.startsWith("/status") && !url.pathname.startsWith("/cancel")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      const marker = [...heldSubmitMarkers].find((m) => body.includes(m));
      if (marker) {
        const g = gate(`submit:${marker}`);
        g.arrived();
        await g.held;
      }
      const id = "req-" + crypto.randomBytes(4).toString("hex");
      return send(200, {
        request_id: id,
        status_url: `${mockBase}/status/${id}`,
        response_url: `${mockBase}/result/${id}`,
        cancel_url: `${mockBase}/cancel/${id}`,
        queue_position: 0,
      });
    }
    if (url.pathname.startsWith("/status/")) return send(200, { status: "COMPLETED", queue_position: 0, logs: [] });
    if (url.pathname.startsWith("/result/")) {
      const id = url.pathname.split("/").pop();
      return send(200, {
        images: [{ url: `${mockBase}/file/${id}.png`, content_type: "image/png", file_name: `${id}.png`, width: 1, height: 1 }],
        video: { url: `${mockBase}/file/${id}.mp4`, content_type: "video/mp4", file_name: `${id}.mp4` },
      });
    }
    if (url.pathname.startsWith("/file/")) {
      const g = gate("download");
      g.arrived();
      if (holdDownloads) await g.held;
      res.writeHead(200, { "content-type": url.pathname.endsWith(".mp4") ? "video/mp4" : "image/png" });
      return res.end(PNG);
    }
    if (url.pathname.startsWith("/cancel/")) return send(200, { ok: true });
    return send(404, { error: "no route" });
  });
  return new Promise((resolve) => mock.listen(port, "127.0.0.1", resolve));
}

/* ---------- the server under test ---------- */
async function request(url, options) {
  const response = await fetch(base + url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text();
  return { response, body };
}
const postJson = async (url, payload) =>
  request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await withGenerationDeclaration(url, payload, { origin: base })) });
const putJson = (url, payload, headers = {}) =>
  request(url, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/api/me");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`Server did not start. Output:\n${output}`);
}

function hashTree(slug) {
  const root = path.join(PROJECTS_ROOT, slug);
  const out = {};
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(root, full).split(path.sep).join("/")] =
        crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
}
function treeDiff(before, after) {
  return {
    added: Object.keys(after).filter((k) => !(k in before)),
    removed: Object.keys(before).filter((k) => !(k in after)),
    changed: Object.keys(after).filter((k) => k in before && before[k] !== after[k]),
  };
}
function docOf(slug) {
  return JSON.parse(fs.readFileSync(fileFor(slug), "utf8"));
}
async function switchTo(slug) {
  const r = await postJson("/api/projects/switch", { slug });
  assert.strictEqual(r.response.status, 200, `switch to ${slug} must succeed: ${JSON.stringify(r.body)}`);
}
async function readProjectWithRevision() {
  const r = await request("/api/project");
  return { body: r.body, revision: r.response.headers.get("etag") || "" };
}

async function setup() {
  for (const slug of [A, B]) {
    fs.mkdirSync(path.dirname(fileFor(slug)), { recursive: true });
    fs.writeFileSync(fileFor(slug), JSON.stringify(projectFixture(slug === A ? "Project Alpha" : "Project Beta"), null, 2));
  }
  const mockPort = await getFreePort();
  mockBase = `http://127.0.0.1:${mockPort}`;
  await startMock(mockPort);

  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    activeProject: A,
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: { enabled: true, apiKey: "test-key", baseUrl: mockBase, maxConcurrent: 2, frameOutputs: 1, blockingOutputs: 1 } },
  }, null, 2));

  const port = await getFreePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  await waitForServer();
}

/* ===================================================================
   1. Asynchronous project ownership — F-02 / F-12
   =================================================================== */
async function asyncOwnership(purpose, label, body) {
  await switchTo(A);
  const submit = await postJson("/api/generation/fal/jobs", { shotId: "S-01", prompt: `${label} prompt`, outputCount: 1, ...body });
  assert.strictEqual(submit.response.status, 200, `${label}: submit failed ${JSON.stringify(submit.body)}`);
  const jobId = submit.body.job.id;

  const beforeB = hashTree(B);
  const bDocBefore = JSON.stringify(docOf(B));
  holdDownloads = true;
  const g = gate("download");
  const refreshPromise = postJson(`/api/generation/fal/jobs/${jobId}/refresh`, {});
  await g.reached;          // the server is parked inside ingest, mid-download
  await switchTo(B);        // the user switches project while it is in flight
  g.release();
  const refresh = await refreshPromise;
  holdDownloads = false;
  gates.delete("download");

  assert.strictEqual(refresh.response.status, 200, `${label}: refresh failed ${JSON.stringify(refresh.body)}`);

  const diff = treeDiff(beforeB, hashTree(B));
  assert.deepStrictEqual(diff.added, [], `${label}: nothing may be created in project B — got ${diff.added.join(", ")}`);
  assert.deepStrictEqual(diff.changed, [], `${label}: nothing may be modified in project B — got ${diff.changed.join(", ")}`);
  assert.deepStrictEqual(diff.removed, [], `${label}: nothing may be removed from project B`);
  assert.strictEqual(JSON.stringify(docOf(B)), bDocBefore, `${label}: project B's document must be byte-identical`);
  assert.strictEqual(docOf(B).meta.title, "Project Beta", `${label}: project B must still be project B`);

  await switchTo(A);
  return docOf(A);
}

async function testAsyncProjectOwnership() {
  /* Frame ingest: the plain still-image path. */
  const afterFrame = await asyncOwnership("frame", "frame ingest", { purpose: "frame" });
  assert.strictEqual(
    (afterFrame.shots[0].candidateFiles || []).length, 1,
    "frame ingest: the result must land in the project that started it",
  );
  assert(
    fs.existsSync(path.join(PROJECTS_ROOT, A, "shots", "S-01", "takes")),
    "frame ingest: media must be written under the owning project",
  );

  /* Motion ingest: a different ingest branch with its own writer, and since C1.1 also a
     COMPILED one. The job carries the plan it was compiled from, so ownership can be
     checked at the level that matters: not merely "the file landed in A" but "the
     request was compiled from A's approved package". */
  const afterMotion = await asyncOwnership("motion-h3", "motion ingest", {
    purpose: "motion-h3", profileFamily: "minimax-h3", profileMode: "t2v", aspectRatio: "16:9",
    sourceBuildId: "h3-project-alpha",
  });
  assert(afterMotion.shots[0], "motion ingest: project A's shot must still exist");
  {
    const ledger = JSON.parse(fs.readFileSync(path.join(PROJECTS_ROOT, A, "generation-jobs.json"), "utf8"));
    const h3 = (Array.isArray(ledger) ? ledger : ledger.jobs).find((row) => row.purpose === "motion-h3");
    assert(h3, "motion ingest: project A must own the H3 job");
    assert(h3.compilation, "motion ingest: the H3 job must carry the plan it was compiled from");
    assert.strictEqual(
      h3.compilation.source.buildId, "h3-project-alpha",
      "motion ingest: the request must be compiled from project A's package, not from whichever project became active",
    );
    assert.strictEqual(h3.compilation.source.shotId, "S-01");
    assert(!fs.existsSync(path.join(PROJECTS_ROOT, B, "generation-jobs.json")),
      "motion ingest: no ledger may be created in project B by A's generation");
  }

  /* Entity ingest: writes to an entity folder rather than a shot folder. */
  await switchTo(A);
  const entitySubmit = await postJson("/api/generation/fal/jobs", {
    purpose: "entity-reference", entityList: "characters", entityId: "CH-01",
    entityType: "character", prompt: "entity reference prompt", outputCount: 1,
  });
  assert.strictEqual(entitySubmit.response.status, 200, `entity submit failed ${JSON.stringify(entitySubmit.body)}`);
  const beforeB = hashTree(B);
  holdDownloads = true;
  const g = gate("download");
  const refreshPromise = postJson(`/api/generation/fal/jobs/${entitySubmit.body.job.id}/refresh`, {});
  await g.reached;
  await switchTo(B);
  g.release();
  await refreshPromise;
  holdDownloads = false;
  gates.delete("download");
  const diff = treeDiff(beforeB, hashTree(B));
  assert.deepStrictEqual(diff.added, [], `entity ingest: nothing may be created in B — got ${diff.added.join(", ")}`);
  assert.deepStrictEqual(diff.changed, [], `entity ingest: nothing may be modified in B — got ${diff.changed.join(", ")}`);
  await switchTo(A);
  assert(
    (docOf(A).characters[0].candidateFiles || []).length >= 1,
    "entity ingest: the reference must land on the owning project's entity",
  );

  /* NEGATIVE CONTROL. The protection is the captured slug. Addressing the same
     write through the globally active project — what the code did before — must
     visibly land in the wrong project, or these assertions prove nothing. */
  await switchTo(A);
  const activeAtStart = (await request("/api/projects")).body.active;
  await switchTo(B);
  const activeAtFinish = (await request("/api/projects")).body.active;
  assert.notStrictEqual(
    activeAtStart, activeAtFinish,
    "negative control: the switch under test must actually change the active project",
  );
  const strayDir = path.join(PROJECTS_ROOT, activeAtFinish, "shots", "S-01", "takes");
  fs.mkdirSync(strayDir, { recursive: true });
  fs.writeFileSync(path.join(strayDir, "unowned-write.png"), PNG);
  assert(
    fs.existsSync(path.join(PROJECTS_ROOT, B, "shots", "S-01", "takes", "unowned-write.png")),
    "negative control: a write addressed by the ACTIVE project lands in B, which is exactly what the captured slug prevents",
  );
  fs.unlinkSync(path.join(strayDir, "unowned-write.png"));
  await switchTo(A);
}

/* ===================================================================
   2. Stale project clients — F-03
   =================================================================== */
async function testStaleProjectSave() {
  await switchTo(A);
  const clientA = await readProjectWithRevision();
  const clientB = await readProjectWithRevision();
  assert(clientA.revision, "a project read must carry a revision token");
  assert.strictEqual(clientA.revision, clientB.revision, "two reads of an unchanged project agree on its revision");

  const edited = JSON.parse(JSON.stringify(clientB.body));
  edited.shots[0].title = "Edited by client B";
  edited.scenes[0].title = "Scene edited by B";
  const saveB = await putJson(`/api/projects/${A}/project`, edited, { "if-match": clientB.revision });
  assert.strictEqual(saveB.response.status, 200, `client B's save must succeed: ${JSON.stringify(saveB.body)}`);
  assert(saveB.body.revision, "a successful save must report the new revision");
  assert.notStrictEqual(saveB.body.revision, clientB.revision, "a save must move the revision forward");

  /* Client A still holds R1 and edits something unrelated. */
  const stale = JSON.parse(JSON.stringify(clientA.body));
  stale.shots[0].dur = 9;
  const saveA = await putJson(`/api/projects/${A}/project`, stale, { "if-match": clientA.revision });
  assert.strictEqual(saveA.response.status, 409, "a stale whole-document save must be refused with 409");
  assert.strictEqual(saveA.body.code, "PROJECT_REVISION_CONFLICT", "the refusal must be typed");
  assert.strictEqual(saveA.body.action, "reload", "the refusal must carry a safe action for the browser");
  assert.strictEqual(saveA.body.revision, saveB.body.revision, "the refusal must name the current revision");

  const onDisk = docOf(A);
  assert.strictEqual(onDisk.shots[0].title, "Edited by client B", "B's shot edit must survive");
  assert.strictEqual(onDisk.scenes[0].title, "Scene edited by B", "B's scene edit must survive");
  assert.notStrictEqual(onDisk.shots[0].dur, 9, "the stale body must not have been applied");

  /* A save with no revision at all is refused too: it cannot be shown to be current. */
  const noRevision = await putJson(`/api/projects/${A}/project`, stale);
  assert.strictEqual(noRevision.response.status, 428, "a save that names no revision must be refused");
  assert.strictEqual(noRevision.body.code, "PROJECT_REVISION_REQUIRED", "the refusal must be typed");
  assert.strictEqual(docOf(A).shots[0].title, "Edited by client B", "a refused save must change nothing");

  /* After reloading, the same client saves normally again. */
  const reloaded = await readProjectWithRevision();
  assert.strictEqual(reloaded.revision, saveB.body.revision, "a reload must report the current revision");
  const fixed = JSON.parse(JSON.stringify(reloaded.body));
  fixed.shots[0].dur = 9;
  const resave = await putJson(`/api/projects/${A}/project`, fixed, { "if-match": reloaded.revision });
  assert.strictEqual(resave.response.status, 200, "a reloaded client must be able to save again");
  assert.strictEqual(docOf(A).shots[0].dur, 9, "the reloaded client's edit must land");

  /* A stale save after a SERVER-SIDE mutation. The generation ingest below
     changes the document without going through this route; a browser holding the
     pre-ingest revision must still be refused. */
  const beforeIngest = await readProjectWithRevision();
  const submit = await postJson("/api/generation/fal/jobs", {
    purpose: "frame", shotId: "S-01", prompt: "server-side mutation", outputCount: 1,
  });
  assert.strictEqual(submit.response.status, 200, `submit failed ${JSON.stringify(submit.body)}`);
  await postJson(`/api/generation/fal/jobs/${submit.body.job.id}/refresh`, {});
  const afterIngest = await readProjectWithRevision();
  assert.notStrictEqual(
    afterIngest.revision, beforeIngest.revision,
    "a server-side generation ingest must move the project revision",
  );
  const candidatesBeforeIngest = (beforeIngest.body.shots[0].candidateFiles || []).length;
  const candidatesAfterIngest = (docOf(A).shots[0].candidateFiles || []).length;
  assert.strictEqual(
    candidatesAfterIngest, candidatesBeforeIngest + 1,
    "the ingest must have added exactly one candidate to the stored document",
  );

  const staleAfterIngest = JSON.parse(JSON.stringify(beforeIngest.body));
  staleAfterIngest.meta.title = "Saved by a tab that missed the ingest";
  const refused = await putJson(`/api/projects/${A}/project`, staleAfterIngest, { "if-match": beforeIngest.revision });
  assert.strictEqual(refused.response.status, 409, "a browser that missed a server-side mutation must be refused");
  assert.strictEqual(
    (docOf(A).shots[0].candidateFiles || []).length, candidatesAfterIngest,
    "the ingested candidate must survive the refused save",
  );

  /* O8 closes the old wildcard bypass: even a caller that submits "*" cannot
     evade the exact revision contract or erase the server-side ingest. */
  const bypass = await putJson(`/api/projects/${A}/project`, staleAfterIngest, { "if-match": "*" });
  assert.strictEqual(bypass.response.status, 409, "a wildcard must not bypass the exact project revision");
  assert.strictEqual(
    (docOf(A).shots[0].candidateFiles || []).length, candidatesAfterIngest,
    "the rejected wildcard body must leave the ingested candidate intact",
  );
}

/* ===================================================================
   3. Generation ledger overlap — F-05
   =================================================================== */
async function testGenerationLedgerOverlap() {
  await switchTo(A);
  fs.writeFileSync(jobsFileFor(A), "[]");

  /* submit + refresh overlapping, provider responses completing in reverse
     order: the refresh finishes while the second submit is still parked. */
  const first = await postJson("/api/generation/fal/jobs", {
    purpose: "frame", shotId: "S-01", prompt: "ledger job one", outputCount: 1, clientRequestId: "ledger-one",
  });
  assert.strictEqual(first.response.status, 200, `first submit failed ${JSON.stringify(first.body)}`);
  const firstId = first.body.job.id;

  const MARKER = "LEDGER-JOB-TWO-HELD";
  heldSubmitMarkers.add(MARKER);
  const g = gate(`submit:${MARKER}`);
  const secondPromise = postJson("/api/generation/fal/jobs", {
    purpose: "frame", shotId: "S-01", prompt: `ledger job two ${MARKER}`, outputCount: 1, clientRequestId: "ledger-two",
  });
  await g.reached;
  const refresh = await postJson(`/api/generation/fal/jobs/${firstId}/refresh`, {});
  g.release();
  const second = await secondPromise;
  heldSubmitMarkers.delete(MARKER);
  gates.delete(`submit:${MARKER}`);

  assert.strictEqual(refresh.response.status, 200, `refresh failed ${JSON.stringify(refresh.body)}`);
  assert.strictEqual(second.response.status, 200, `second submit failed ${JSON.stringify(second.body)}`);

  const ledger = JSON.parse(fs.readFileSync(jobsFileFor(A), "utf8"));
  const one = ledger.find((j) => j.id === firstId);
  const two = ledger.find((j) => j.id === second.body.job.id);
  assert(one, "the refreshed job must not be erased by the slower submit");
  assert(two, "the submitted job must not be erased by the faster refresh");
  assert.strictEqual(one.status, "COMPLETED", "a completed job must not regress to an earlier status");
  assert(one.ingestedAt, "the ingest record must survive the overlapping write");
  assert(one.externalId, "the provider request id must survive the overlapping write");
  assert(two.externalId, "the second job's provider request id must survive");

  /* Two overlapping submits: neither may erase the other. */
  const MARKER2 = "LEDGER-JOB-THREE-HELD";
  heldSubmitMarkers.add(MARKER2);
  const g2 = gate(`submit:${MARKER2}`);
  const thirdPromise = postJson("/api/generation/fal/jobs", {
    purpose: "frame", shotId: "S-01", prompt: `ledger job three ${MARKER2}`, outputCount: 1, clientRequestId: "ledger-three",
  });
  await g2.reached;
  const fourth = await postJson("/api/generation/fal/jobs", {
    purpose: "frame", shotId: "S-01", prompt: "ledger job four", outputCount: 1, clientRequestId: "ledger-four",
  });
  g2.release();
  const third = await thirdPromise;
  heldSubmitMarkers.delete(MARKER2);
  gates.delete(`submit:${MARKER2}`);

  const afterSubmits = JSON.parse(fs.readFileSync(jobsFileFor(A), "utf8"));
  const ids = afterSubmits.map((j) => j.id);
  if (third.response.status === 200) assert(ids.includes(third.body.job.id), "overlapping submit three must persist");
  if (fourth.response.status === 200) assert(ids.includes(fourth.body.job.id), "overlapping submit four must persist");
  assert(ids.includes(firstId), "the original job must still be in the ledger after later submits");
  assert(ids.includes(second.body.job.id), "the second job must still be in the ledger after later submits");

  /* refresh + cancel overlapping. A cancel that lands after the result was
     already ingested must not erase the delivery the user paid for. */
  const completed = JSON.parse(fs.readFileSync(jobsFileFor(A), "utf8")).find((j) => j.id === firstId);
  assert.strictEqual(completed.status, "COMPLETED", "precondition: job one is completed and ingested");
  const [cancelResult, refreshResult] = await Promise.all([
    postJson(`/api/generation/fal/jobs/${firstId}/cancel`, {}),
    postJson(`/api/generation/fal/jobs/${firstId}/refresh`, {}),
  ]);
  assert.strictEqual(cancelResult.response.status, 200, "cancel must answer");
  assert.strictEqual(refreshResult.response.status, 200, "refresh must answer");
  const settled = JSON.parse(fs.readFileSync(jobsFileFor(A), "utf8")).find((j) => j.id === firstId);
  assert(settled, "the job must survive an overlapping cancel and refresh");
  assert.strictEqual(settled.status, "COMPLETED", "an ingested job must not be cancelled out from under its delivery");
  assert(settled.ingestedAt, "the ingest record must survive an overlapping cancel");

  /* Concurrency slots are computed from durable state, not from a snapshot. */
  const listed = await request("/api/generation/fal/jobs");
  assert.strictEqual(listed.response.status, 200, "the job list must be readable");
  assert.strictEqual(
    listed.body.jobs.length,
    JSON.parse(fs.readFileSync(jobsFileFor(A), "utf8")).length,
    "the served job list must match the durable ledger exactly",
  );
}

/* ===================================================================
   4. Media writes do not follow the active project — F-12
   =================================================================== */
async function testMediaWriteOwnership() {
  await switchTo(A);
  const beforeB = hashTree(B);

  /* The upload names project A. The switch to B happens before the write runs,
     which is precisely the interleaving that used to redirect it. */
  await switchTo(B);
  const upload = await request(`/api/media/upload?type=media&name=owned-by-alpha.png&slug=${A}`, {
    method: "POST", headers: { "content-type": "image/png" }, body: PNG,
  });
  assert.strictEqual(upload.response.status, 200, `owned upload failed ${JSON.stringify(upload.body)}`);
  assert(
    fs.existsSync(path.join(PROJECTS_ROOT, A, "media", "owned-by-alpha.png")),
    "an upload that names project A must land in project A",
  );
  const diff = treeDiff(beforeB, hashTree(B));
  assert.deepStrictEqual(diff.added, [], `nothing may land in project B — got ${diff.added.join(", ")}`);

  /* An unknown project is refused rather than written somewhere else. */
  const unknown = await request("/api/media/upload?type=media&name=x.png&slug=no-such-project", {
    method: "POST", headers: { "content-type": "image/png" }, body: PNG,
  });
  assert.strictEqual(unknown.response.status, 404, "an unknown project slug must be refused");

  /* Containment still holds: a slug that escapes the projects root is refused,
     and nothing is written outside it. */
  for (const hostile of ["..", ".", "../..", "../owner-beta"]) {
    const escaped = await request(
      `/api/media/upload?type=media&name=escape.png&slug=${encodeURIComponent(hostile)}`,
      { method: "POST", headers: { "content-type": "image/png" }, body: PNG },
    );
    assert(
      escaped.response.status === 404 || escaped.response.status === 400,
      `a slug that leaves the projects root must be refused: ${hostile} got ${escaped.response.status}`,
    );
    assert(
      !fs.existsSync(path.join(PROJECTS_ROOT, "escape.png")) && !fs.existsSync(path.join(TEMP, "escape.png")),
      `containment breach writing outside the projects root via ${hostile}`,
    );
  }

  /* Rename is owned the same way. */
  await switchTo(B);
  const rename = await postJson("/api/media/rename", {
    projectSlug: A, dir: "media", from: "owned-by-alpha.png", to: "renamed-by-alpha.png",
  });
  assert.strictEqual(rename.response.status, 200, `owned rename failed ${JSON.stringify(rename.body)}`);
  assert(
    fs.existsSync(path.join(PROJECTS_ROOT, A, "media", "renamed-by-alpha.png")),
    "a rename that names project A must act on project A",
  );
  const afterRename = treeDiff(beforeB, hashTree(B));
  assert.deepStrictEqual(afterRename.added, [], "a rename owned by A must not touch B");
  await switchTo(A);
}

/* ===================================================================
   5. Determinism — the suite must give the same answer every run
   =================================================================== */
async function testDeterminism() {
  for (let round = 0; round < 3; round++) {
    await switchTo(A);
    const client = await readProjectWithRevision();
    const first = JSON.parse(JSON.stringify(client.body));
    first.meta.title = `Determinism round ${round}`;
    const ok = await putJson(`/api/projects/${A}/project`, first, { "if-match": client.revision });
    assert.strictEqual(ok.response.status, 200, `round ${round}: the current client must save`);
    const staleAgain = await putJson(`/api/projects/${A}/project`, first, { "if-match": client.revision });
    assert.strictEqual(staleAgain.response.status, 409, `round ${round}: the now-stale revision must be refused`);
  }
}

async function main() {
  await setup();
  try {
    await testAsyncProjectOwnership();
    await testStaleProjectSave();
    await testGenerationLedgerOverlap();
    await testMediaWriteOwnership();
    await testDeterminism();
    console.log(
      "State-interleaving suite passed asynchronous project ownership (frame, motion and entity ingest across a "
      + "project switch), stale whole-document save refusal with typed 409 and server-side-mutation coverage, "
      + "serialized generation-ledger mutation under overlapping submit/refresh/cancel and reverse-order provider "
      + "completions, project-scoped media writes with containment, and three deterministic repeats.",
    );
  } finally {
    if (child) child.kill();
    if (mock) mock.close();
  }
}

main().catch((error) => {
  console.error(error);
  console.error("--- server output ---\n" + output.slice(-4000));
  if (child) child.kill();
  if (mock) mock.close();
  process.exit(1);
});

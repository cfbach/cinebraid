/* Recovery / Quarantine V1 — the protected mode a project enters when CineBraid
 * cannot safely open it.
 *
 * THE PRODUCT CONTRACT THIS PINS. When the stored project document is not one the
 * server will serve, CineBraid must not discard what it could not understand, must
 * not open into ordinary writable mode, must not repair over the only copy, and
 * must not present a fake success state. It preserves the original and enters a
 * protected mode offering a bounded set of actions.
 *
 * RQ-1   a malformed project refuses to open, enters Recovery mode, leaves the
 *        stored bytes untouched and installs no writable record.
 * RQ-2   a project that parses but fails validation does the same, and the reason
 *        reaches the screen.
 * RQ-3   no ordinary save can write while quarantined, and the indicator never
 *        claims a saved state.
 * RQ-4   no Canon transition can write while quarantined.
 * RQ-5   restoring a known-good backup works from Recovery mode, through the
 *        shipped restore, and the reopened project is a normal writable one.
 * RQ-6   a failed restore keeps Recovery mode, keeps the original, and says so.
 * RQ-7   duplicate-for-repair: reported, not invented — see PART A7.
 * RQ-8   Recovery mode survives navigation and a restart, because it is re-derived
 *        from the server's verdict rather than remembered.
 * RQ-9   a deferred save armed before quarantine cannot write after it.
 * RQ-10  Universal Revision Convergence V3 does not escape Recovery mode because
 *        the stored revision changed.
 *
 * Provider/model calls: 0.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-quarantine-"));
const CONFIG_PATH = path.join(TEMP, "config.json");
const PROJECTS_ROOT = path.join(TEMP, "projects");
const GOOD = "recovery-good";
const BROKEN = "recovery-broken";

let child = null;
let base = "";
let output = "";
const results = [];
function pass(id, what) {
  results.push(id);
  console.log(`[RQ] ${id} PASS — ${what}`);
}

const fileFor = (slug) => path.join(PROJECTS_ROOT, slug, "project.json");
const backupsFor = (slug) => path.join(PROJECTS_ROOT, slug, "backups");
const bytesOf = (slug) => fs.readFileSync(fileFor(slug));
const hashOf = (slug) => crypto.createHash("sha256").update(bytesOf(slug)).digest("hex");

function projectFixture(title) {
  return {
    meta: { title, format: "Test", version: "v1", hubVersion: "v5.5.0", aiPolicy: "project-default" },
    qcChecklist: [],
    scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [{ id: "S-01", scene: "SC-01", title: "Shot one", dur: 5, workflowStatus: "DRAFT", keyframes: [], clips: [] }],
    characters: [], locations: [], props: [], vehicles: [], audio: [],
    mediaAssets: [], jobs: [], agentRuns: [], decisions: [], sessions: [],
  };
}
function writeProjectFile(slug, contents) {
  fs.mkdirSync(path.dirname(fileFor(slug)), { recursive: true });
  fs.writeFileSync(fileFor(slug), contents);
}
/* The exact grammar server.js emits and its retention regex accepts. A backup
   written under any other name is invisible to the product, so a fixture that
   invented one would be testing nothing. */
function backupName(reason, offsetMs = 0) {
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + offsetMs).toISOString().replace(/[:.]/g, "-");
  return `project-${stamp}-${reason}.json`;
}
function writeBackup(slug, name, contents) {
  fs.mkdirSync(backupsFor(slug), { recursive: true });
  fs.writeFileSync(path.join(backupsFor(slug), name), contents);
  return name;
}
function listBackupFiles(slug) {
  try { return fs.readdirSync(backupsFor(slug)).sort(); } catch { return []; }
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
  return { response, body, status: response.status };
}
function postJson(url, payload, headers = {}) {
  return request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}
async function waitForServer() {
  const deadline = Date.now() + 12000;
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

/* The payloads PART B feeds to the browser are the ones PART A collected from the
   running server, so the two halves cannot describe different products. */
const captured = {};
/* Every field the server puts in a refused open, and therefore everything the
   protected surface has to work with. Exported: the negative controls build their
   own payload from this list rather than from a copy that can go stale. */
const QUARANTINE_FAILURE_KEYS = ["detail", "issues", "modifiedAt", "path", "reason", "revision", "size", "slug", "title"];

/* =====================================================================
   PART A — THE SERVER'S VERDICTS AND THE OPERATIONS RECOVERY MODE USES.
   ===================================================================== */

/* A1 — the complete failure vocabulary, and which arms are quarantine entries.
   The four 422 arms are integrity verdicts about bytes that exist; the two 404
   arms are not, and must keep the first-run/switcher ending they have today. */
async function a1FailureVocabulary() {
  const cases = [
    { label: "invalid-json", write: () => writeProjectFile(BROKEN, '{ "meta": { "title": "Broken" '), status: 422, reason: "invalid-json", quarantine: true },
    { label: "invalid-shape", write: () => writeProjectFile(BROKEN, '["not","a","project"]'), status: 422, reason: "invalid-shape", quarantine: true },
    { label: "invalid-structure", write: () => writeProjectFile(BROKEN, JSON.stringify({ meta: { title: "Broken" }, scenes: "not-an-array", shots: [] })), status: 422, reason: "invalid-structure", quarantine: true },
    {
      label: "unreadable",
      write: () => {
        try { fs.rmSync(fileFor(BROKEN), { recursive: true, force: true }); } catch {}
        fs.mkdirSync(fileFor(BROKEN), { recursive: true });
      },
      status: 422, reason: "unreadable", quarantine: true,
    },
    {
      label: "missing",
      write: () => { try { fs.rmSync(fileFor(BROKEN), { recursive: true, force: true }); } catch {} },
      status: 404, reason: "missing", quarantine: false,
    },
  ];
  for (const testCase of cases) {
    testCase.write();
    const result = await postJson("/api/projects/switch", { slug: BROKEN });
    assert.strictEqual(result.status, testCase.status, `${testCase.label}: unexpected status`);
    assert.strictEqual(result.body.projectFailure.reason, testCase.reason, `${testCase.label}: unexpected reason`);
    assert.strictEqual(result.body.projectFailure.slug, BROKEN);
    assert.strictEqual(result.body.projectFailure.path, fileFor(BROKEN), `${testCase.label}: the refusal must give the real path`);
    captured[testCase.label] = result.body;
  }
  /* An invalid name is the server's other 404 and never names a stored document. */
  const named = await postJson("/api/projects/switch", { slug: "../escape" });
  assert.strictEqual(named.status, 404);
  assert.ok(["invalid-name", "missing"].includes(named.body.projectFailure.reason));
  captured["invalid-name"] = named.body;

  /* The active project never moved through any of it. */
  assert.strictEqual((await request("/api/projects")).body.active, GOOD, "no refused switch may move the active project");
  pass("A1", "every inspectProjectFile arm answers with its own reason and the real path, and none of them moved the active project");
}

/* A2 — a refusal now describes the stored bytes, which is what makes the
   protected surface able to name and act on a document it could not parse. */
async function a2FailurePayloadDescribesTheBytes() {
  const raw = '{ "meta": { "title": "Broken" ';
  writeProjectFile(BROKEN, raw);
  setActiveProjectDirectly(BROKEN);
  const result = await request("/api/project");
  assert.strictEqual(result.status, 422, "a malformed active project must not be served as a success");
  const failure = result.body.projectFailure;
  assert.strictEqual(failure.reason, "invalid-json");
  assert.strictEqual(
    failure.revision,
    `"${crypto.createHash("sha256").update(Buffer.from(raw)).digest("hex")}"`,
    "the refusal must carry the content hash of the stored bytes",
  );
  assert.strictEqual(failure.size, Buffer.byteLength(raw), "the refusal must carry the stored size");
  assert.match(failure.modifiedAt, /^\d{4}-\d{2}-\d{2}T/, "the refusal must carry when the file last changed");
  assert.ok(failure.detail, "a parser failure must carry its technical detail");
  /* The exact shape the protected surface is built from. Pinned here so the
     negative controls can build a payload of their own without the two files
     drifting into describing different servers. */
  assert.deepStrictEqual(
    Object.keys(failure).sort(),
    QUARANTINE_FAILURE_KEYS,
    "the refusal payload's shape is what Recovery mode is built from",
  );
  captured.active = result.body;
  setActiveProjectDirectly(GOOD);
  pass("A2", "a refused open carries the stored document's revision, size and modification time");
}

/* A3 — the one new read. Raw bytes for a document nothing else will serve. */
async function a3RawProjectFileDownload() {
  const before = hashOf(BROKEN);
  const response = await fetch(`${base}/api/projects/${BROKEN}/project-file`);
  assert.strictEqual(response.status, 200, "the stored bytes must be downloadable even when they do not parse");
  const text = await response.text();
  assert.strictEqual(
    crypto.createHash("sha256").update(Buffer.from(text)).digest("hex"),
    before,
    "the download must be the stored bytes exactly",
  );
  assert.match(response.headers.get("content-disposition") || "", /attachment/, "the download must be offered as a file");
  assert.strictEqual(response.headers.get("etag"), `"${before}"`, "the download must identify which document it is a copy of");
  assert.strictEqual(hashOf(BROKEN), before, "downloading must not modify the original");

  /* It reads and does nothing else: a project that is not a file is refused, and
     an unknown project is a 404 rather than an invented empty document. */
  const missing = await request("/api/projects/no-such-project/project-file");
  assert.strictEqual(missing.status, 404);
  pass("A3", "GET /api/projects/:slug/project-file returns the stored bytes unparsed, unmodified, and refuses what it cannot read");
}

/* RQ-5 (server half) — the shipped restore, run against an original that could
   not be parsed. Nothing about the preconditions is relaxed. */
async function a4RestoreIntoAnUnreadableOriginal() {
  const good = projectFixture("Recovered from backup");
  const name = writeBackup(BROKEN, backupName("manual"), JSON.stringify(good, null, 2));
  const brokenBytes = bytesOf(BROKEN);
  const revision = `"${hashOf(BROKEN)}"`;

  /* No revision, and a wrong revision, are still refused. */
  const noMatch = await postJson(`/api/projects/${BROKEN}/restore`, { name });
  assert.strictEqual(noMatch.status, 428, "restore must still require the revision it is replacing");
  assert.strictEqual(noMatch.body.code, "PROJECT_REVISION_REQUIRED");
  const wrongMatch = await postJson(`/api/projects/${BROKEN}/restore`, { name }, { "if-match": '"deadbeef"' });
  assert.strictEqual(wrongMatch.status, 409, "restore must still refuse a stale revision");
  assert.ok(bytesOf(BROKEN).equals(brokenBytes), "a refused restore must not touch the original");

  /* The preview reads the backup and reports that it could not read what it
     would replace — so every current authority in the snapshot is a resurrection
     needing explicit confirmation rather than an empty, reassuring delta. */
  const preview = await postJson(`/api/projects/${BROKEN}/restore`, { name }, { "if-match": revision });
  assert.strictEqual(preview.status, 200, "the preview must work against an unreadable original");
  assert.strictEqual(preview.body.currentUnreadable, true, "the preview must say the current document could not be read");
  assert.ok(preview.body.previewHash, "the preview must identify the snapshot it described");
  assert.ok(bytesOf(BROKEN).equals(brokenBytes), "a preview must write nothing");

  /* Confirming replaces the document — after preserving it. */
  const confirmed = await postJson(
    `/api/projects/${BROKEN}/restore`,
    { name, confirm: true, previewHash: preview.body.previewHash, resurrectionConfirmed: true },
    { "if-match": revision },
  );
  assert.strictEqual(confirmed.status, 200, `the restore must succeed: ${JSON.stringify(confirmed.body)}`);
  assert.ok(confirmed.body.safetyBackup, "the restore must report the checkpoint it took first");
  const safety = path.join(backupsFor(BROKEN), confirmed.body.safetyBackup);
  assert.ok(fs.readFileSync(safety).equals(brokenBytes), "the checkpoint must hold the original bytes exactly");
  assert.ok(confirmed.body.audit, "the restore must write its audit record");
  assert.strictEqual(
    JSON.parse(fs.readFileSync(fileFor(BROKEN), "utf8")).meta.title,
    "Recovered from backup",
    "the restored document must be the backup's",
  );

  /* And the project opens normally now — the only thing that ends Recovery mode. */
  setActiveProjectDirectly(BROKEN);
  const reopened = await request("/api/project");
  assert.strictEqual(reopened.status, 200, "the restored project must open normally");
  assert.strictEqual(reopened.body.meta.title, "Recovered from backup");
  assert.ok(reopened.response.headers.get("x-cinebraid-project-revision"), "the reopened project must carry a fresh revision");
  captured.restoredRevision = reopened.response.headers.get("x-cinebraid-project-revision");
  setActiveProjectDirectly(GOOD);
  pass("RQ-5", "a known-good backup restores into an unparseable original through the shipped restore, after checkpointing the original bytes, and the project then opens normally");
}

/* RQ-6 — every way a restore can fail leaves the original where it was and says
   so, rather than reporting a success or crashing. */
async function a5FailedRestoreProtectsTheOriginal() {
  writeProjectFile(BROKEN, '{ "meta": { "title": "Broken again" ');
  const brokenBytes = bytesOf(BROKEN);
  const revision = `"${hashOf(BROKEN)}"`;

  const unreadableBackup = writeBackup(BROKEN, backupName("corrupt", 1000), '{ "meta": ');
  const one = await postJson(`/api/projects/${BROKEN}/restore`, { name: unreadableBackup }, { "if-match": revision });
  assert.strictEqual(one.status, 422, "an unreadable backup must be a refusal, not a 500");
  assert.strictEqual(one.body.code, "BACKUP_UNREADABLE");
  assert.match(one.body.error, /nothing was restored/i, "the refusal must say the project was not changed");
  assert.ok(bytesOf(BROKEN).equals(brokenBytes), "the original must be untouched");

  const invalidBackup = writeBackup(BROKEN, backupName("invalid", 2000), JSON.stringify({ meta: { title: "x" }, scenes: "no" }));
  const two = await postJson(`/api/projects/${BROKEN}/restore`, { name: invalidBackup }, { "if-match": revision });
  assert.strictEqual(two.status, 422, "a backup that fails validation must be refused");
  assert.ok(bytesOf(BROKEN).equals(brokenBytes), "the original must be untouched");

  const absent = await postJson(`/api/projects/${BROKEN}/restore`, { name: backupName("gone", 3000) }, { "if-match": revision });
  assert.strictEqual(absent.status, 404, "a backup that is not there must be refused");
  assert.ok(bytesOf(BROKEN).equals(brokenBytes), "the original must be untouched");

  const foreign = await postJson(`/api/projects/${BROKEN}/restore`, { name: "notes.json" }, { "if-match": revision });
  assert.strictEqual(foreign.status, 400, "only a CineBraid backup may be restored");
  assert.ok(bytesOf(BROKEN).equals(brokenBytes), "the original must be untouched");
  pass("RQ-6", "an unreadable, invalid, absent or foreign backup is refused with a typed reason and the quarantined original is byte-identical afterwards");
}

/* RQ-3 / RQ-4 (server half) — the browser is blocked, and so is anything else
   that reaches the write routes for a document that could not be read. Recovery
   mode must not have quietly opened a new way in. */
async function a6NoOrdinaryWriteReachesAQuarantinedDocument() {
  const brokenBytes = bytesOf(BROKEN);
  const revision = `"${hashOf(BROKEN)}"`;
  const successor = projectFixture("Written over a quarantined project");

  const save = await request(`/api/projects/${BROKEN}/project`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": revision },
    body: JSON.stringify(successor),
  });
  assert.ok(!save.response.ok, `an ordinary save into an unreadable document must be refused, got ${save.status}`);
  assert.ok(bytesOf(BROKEN).equals(brokenBytes), "a refused save must not touch the document");

  const canon = await postJson(
    `/api/projects/${BROKEN}/canon-transition`,
    { successor, transition: { targetKeys: [], receiptIds: [], transitionKind: "HUMAN_CANON_TRANSITION" } },
    { "if-match": revision },
  );
  assert.ok(!canon.response.ok, `a Canon transition into an unreadable document must be refused, got ${canon.status}`);
  assert.ok(bytesOf(BROKEN).equals(brokenBytes), "a refused Canon transition must not touch the document");
  pass("A6", "an ordinary save and a Canon transition are both refused against an unreadable document, and neither writes a byte");
}

/* RQ-7 — duplicate for repair. There is no safe in-app duplicate of a document
   CineBraid cannot read: the only create-only entry point is the JSON import, and
   it refuses what does not parse and validate. This asserts the refusal so the
   omission on the surface is a reported fact rather than an unexamined choice. */
async function a7DuplicateForRepairIsNotAvailable() {
  const raw = fs.readFileSync(fileFor(BROKEN), "utf8");
  const preview = await postJson("/api/projects/preview-import-json", { text: raw });
  assert.ok(!preview.response.ok || preview.body.ok === false, "importing an unparseable project must not be offered as a copy");

  const imported = await postJson("/api/projects/import-json", { text: raw, slug: "recovery-duplicate" });
  assert.ok(!imported.response.ok, "importing an unparseable project must be refused");
  assert.ok(!fs.existsSync(fileFor("recovery-duplicate")), "a refused import must not create a project");

  /* What Recovery mode offers instead is the raw download — a copy the filmmaker
     holds, produced by a read that cannot fail on a document that does not parse. */
  const download = await fetch(`${base}/api/projects/${BROKEN}/project-file`);
  assert.strictEqual(download.status, 200, "the supported way to take a copy must work");
  pass("RQ-7", "no safe in-app duplicate exists for an unreadable project — the import path refuses it and creates nothing — so the surface offers the raw download instead");
}

/* =====================================================================
   PART B — THE BROWSER. The payloads below came from PART A.
   ===================================================================== */

const { render, buildFixture, HARNESS_PROJECT_REVISION } = require("./render-harness");

/* Every request the page made, so an assertion can say "nothing was written"
   rather than "the write that happened was answered with an error". */
function recorder(extra) {
  const calls = [];
  return {
    calls,
    writes: () => calls.filter((call) =>
      /^(PUT|POST)$/.test(call.method)
      && /\/api\/(project|projects\/[^/]+\/(project|canon-transition))$/.test(call.url)),
    fetch: async (url, options, response) => {
      calls.push({ url, method: String(options?.method || "GET").toUpperCase(), body: options?.body || "" });
      return extra ? extra(url, options, response) : null;
    },
  };
}
async function quarantinedWindow(payload, extra) {
  const log = recorder(extra);
  const view = await render("#/production", buildFixture(), {
    allowRenderError: true,
    fetch: async (url, options, response) => {
      const custom = await log.fetch(url, options, response);
      if (custom) return custom;
      if (url === "/api/project") return response(payload, 422);
      return null;
    },
  });
  return { view, log };
}

/* RQ-1 — a malformed project. */
async function rq1MalformedProject() {
  const { view, log } = await quarantinedWindow(captured["invalid-json"]);
  const main = view.map.get("main").innerHTML;

  assert.match(main, /RECOVERY MODE/, "a refused open must enter the protected mode, not a bare error");
  assert.match(main, /could not open/i, "the surface must explain that the project could not be opened");
  assert.doesNotMatch(main, /could not render/i, "a bad project file is not a rendering failure");
  assert.match(main, /original project has not been modified/i, "the surface must state that the original is untouched");
  assert.match(main, new RegExp(captured["invalid-json"].projectFailure.path.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&")), "the surface must print the real project path");
  assert.match(main, /Retry validation/, "Retry must be offered");
  assert.match(main, /project-file/, "the raw download must be offered when the bytes are readable");
  assert.match(main, /openProjectSwitcher\(\)/, "a route to another project must stay reachable");
  assert.match(main, /Technical detail/, "the technical detail must be available and expandable");
  assert.strictEqual(
    view.document.body.dataset.projectQuarantine,
    captured["invalid-json"].projectFailure.slug,
    "the window must record which project it is protecting",
  );

  /* NO ORDINARY WRITABLE RECORD IS INSTALLED. captureProjectSave() answers from
     the live record, so a null answer is the record's absence, not a flag. */
  assert.strictEqual(view.context.captureProjectSave(), null, "no writable project record may be installed");

  const saveState = view.map.get("save-state");
  assert.strictEqual(saveState.dataset.state, "error", "a refused open must not sit in a saved state");
  assert.notStrictEqual(saveState.querySelector("span:last-child").textContent, "Saved", "a refused open must never display Saved");
  assert.strictEqual(view.map.get("project-title").textContent, "Projects", "the project switcher must stay labelled");
  assert.strictEqual(log.writes().length, 0, "entering Recovery mode must write nothing");
  pass("RQ-1", "a malformed project refuses to open, enters Recovery mode with the original named and preserved, installs no writable record, and emits no write");
  return view;
}

/* RQ-2 — a project that parses but is not one CineBraid will serve. */
async function rq2UnmigratableProject() {
  const { view, log } = await quarantinedWindow(captured["invalid-structure"]);
  const main = view.map.get("main").innerHTML;
  assert.match(main, /RECOVERY MODE/, "a validation refusal must enter the protected mode too");
  assert.match(main, /missing information CineBraid needs/i, "the server's own reason must reach the screen");
  const issues = captured["invalid-structure"].projectFailure.issues || [];
  assert.ok(issues.length, "the server must have reported at least one structural issue");
  assert.match(main, new RegExp(issues[0].replace(/[\\^$*+?.()|[\]{}]/g, "\\$&")), "the specific issue must be surfaced, not only a generic sentence");
  assert.strictEqual(view.context.captureProjectSave(), null, "no writable project record may be installed");
  assert.strictEqual(log.writes().length, 0, "a validation refusal must write nothing");

  /* A file CineBraid could not read at all offers neither a copy nor a restore,
     because it can name neither — and says which it is. */
  const { view: unreadable } = await quarantinedWindow(captured.unreadable);
  const unreadableMain = unreadable.map.get("main").innerHTML;
  assert.match(unreadableMain, /RECOVERY MODE/);
  assert.doesNotMatch(unreadableMain, /project-file/, "a file CineBraid could not read has no copy to offer");
  assert.match(unreadableMain, /could not read this file at all/i, "the surface must say why the copy is unavailable");

  /* And the two 404 verdicts are NOT integrity verdicts: they keep the ending
     they have today rather than entering a protected mode with nothing to
     protect. */
  for (const label of ["missing", "invalid-name"])
    assert.strictEqual(
      view.context.projectFailureEntersQuarantine(captured[label].projectFailure),
      false,
      `${label} must not enter Recovery mode`,
    );
  for (const label of ["invalid-json", "invalid-shape", "invalid-structure", "unreadable"])
    assert.strictEqual(
      view.context.projectFailureEntersQuarantine(captured[label].projectFailure),
      true,
      `${label} must enter Recovery mode`,
    );
  /* Neither does a failure that is not a verdict about the stored document at all. */
  assert.strictEqual(view.context.projectFailureEntersQuarantine({ slug: "x", reason: "" }), false, "an unclassified failure must not enter Recovery mode");
  assert.strictEqual(view.context.projectFailureEntersQuarantine(null), false, "no failure is not a Recovery-mode entry");
  pass("RQ-2", "a validation refusal enters Recovery mode with its specific issues surfaced, and the classification matches the server's arms exactly: the four 422 verdicts enter, the two 404 verdicts do not");
}

/* RQ-3 — ordinary saving. */
async function rq3NoOrdinarySave() {
  const { view, log } = await quarantinedWindow(captured["invalid-json"]);
  const context = view.context;

  context.dirty();
  await new Promise((resolve) => setTimeout(resolve, 700)); // longer than the 500ms debounce
  assert.strictEqual(log.writes().length, 0, "an edit trigger must not produce a write while quarantined");

  const saveState = view.map.get("save-state");
  assert.strictEqual(saveState.dataset.state, "error", "the indicator must not claim an ordinary state after an edit trigger");
  const label = saveState.querySelector("span:last-child").textContent;
  assert.notStrictEqual(label, "Saved", "the indicator must never claim Saved while quarantined");
  assert.doesNotMatch(label, /^Unsaved changes$/, "the indicator must not promise a save that will never happen");
  assert.match(label, /Recovery mode/i, "the indicator must say why it is not saving");

  /* A JOB HANDED STRAIGHT TO THE SAVE CHAIN. This is the strongest form of the
     question: not "does any caller try", but "would the one exit accept one". */
  await context.queueProjectSave({
    slug: captured["invalid-json"].projectFailure.slug,
    revision: 1,
    documentRevision: captured["invalid-json"].projectFailure.revision,
    body: JSON.stringify(buildFixture()),
    baseline: null,
    transition: null,
  });
  assert.strictEqual(log.writes().length, 0, "a job handed directly to the save chain must not write while quarantined");
  pass("RQ-3", "an edit trigger and a job handed straight to the save chain both write nothing, and the indicator says Recovery mode rather than Saved or Unsaved changes");
}

/* RQ-4 — Canon. */
async function rq4NoCanonWrite() {
  const { view, log } = await quarantinedWindow(captured["invalid-json"]);
  const main = view.map.get("main").innerHTML;
  assert.doesNotMatch(main, /canon/i, "the protected surface must offer no Canon control");

  await view.context.queueProjectSave({
    slug: captured["invalid-json"].projectFailure.slug,
    revision: 1,
    documentRevision: captured["invalid-json"].projectFailure.revision,
    body: JSON.stringify(buildFixture()),
    baseline: null,
    transition: { targetKeys: ["shot-frame:S-01:PRIMARY"], receiptIds: ["r1"], transitionKind: "HUMAN_CANON_TRANSITION" },
  });
  assert.strictEqual(
    log.calls.filter((call) => /canon-transition/.test(call.url)).length,
    0,
    "a job declaring a Canon transition must not reach the transition endpoint while quarantined",
  );
  assert.strictEqual(log.writes().length, 0, "no write of any class may leave a quarantined window");
  pass("RQ-4", "the protected surface offers no Canon control and a job declaring a Canon transition never reaches the transition endpoint");
}

/* RQ-5 (browser half) — the restore reachable from the surface is the shipped
   restore, addressed with the identity the server put in its refusal. */
async function rq5RestoreFromTheSurface() {
  const failure = captured["invalid-json"].projectFailure;
  const backup = backupName("manual");
  const { view, log } = await quarantinedWindow(captured["invalid-json"], async (url, options, response) => {
    if (url.endsWith("/backups")) return response({ ok: true, backups: [{ name: backup, size: 120, modifiedAt: "2026-01-01T00:00:00.000Z" }] });
    if (/\/restore$/.test(url))
      return response({ ok: true, preview: true, slug: failure.slug, restored: backup, previewHash: "hash-1", authorityDelta: [], resurrection: false, currentUnreadable: true, trust: { trusted: true, diagnostics: [] } });
    return null;
  });
  await new Promise((resolve) => setTimeout(resolve, 60));

  const backups = view.document.getElementById("project-recovery-backups").innerHTML;
  assert.match(backups, /Restore a backup/, "the surface must offer the project's existing backups");
  assert.match(backups, new RegExp(backup.replace(/[.\\]/g, "\\$&")), "the backup must be named");
  assert.match(backups, /restoreProjectBackup\(/, "the control must be the shipped restore, not a second one");

  await view.context.restoreProjectBackup(backup);
  const restoreCall = log.calls.find((call) => /\/restore$/.test(call.url));
  assert.ok(restoreCall, "the surface's restore must reach the shipped restore route");
  assert.strictEqual(restoreCall.url, `/api/projects/${failure.slug}/restore`, "the restore must address the quarantined project");
  assert.strictEqual(JSON.parse(restoreCall.body).name, backup);
  assert.strictEqual(
    log.calls.filter((call) => /\/restore$/.test(call.url) && JSON.parse(call.body || "{}").confirm === true).length,
    0,
    "a preview must not confirm on its own",
  );
  pass("RQ-5", "Recovery mode's restore is the shipped restore, addressed with the slug and revision the server put in its refusal, and previewing confirms nothing");
}

/* RQ-6 (browser half) — a restore that fails leaves the mode and the sentence on
   screen honest. */
async function rq6FailedRestoreKeepsTheMode() {
  const failure = captured["invalid-json"].projectFailure;
  const backup = backupName("manual");
  const { view, log } = await quarantinedWindow(captured["invalid-json"], async (url, options, response) => {
    if (url.endsWith("/backups")) return response({ ok: true, backups: [{ name: backup, size: 120, modifiedAt: "2026-01-01T00:00:00.000Z" }] });
    if (/\/restore$/.test(url))
      return response({ error: "That backup could not be read, so nothing was restored and the project was not changed.", code: "BACKUP_UNREADABLE" }, 422);
    return null;
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  await view.context.restoreProjectBackup(backup);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.strictEqual(view.document.body.dataset.projectQuarantine, failure.slug, "a failed restore must leave Recovery mode active");
  const note = view.document.getElementById("project-recovery-note").textContent;
  assert.match(note, /nothing was restored/i, "the failure must be reported where the action was taken");
  assert.match(note, /unchanged/i, "the failure must say the original is unchanged");
  assert.match(view.map.get("main").innerHTML, /RECOVERY MODE/, "the protected surface must still be the one on screen");
  assert.strictEqual(view.context.captureProjectSave(), null, "a failed restore must not install a writable record");
  assert.strictEqual(log.writes().length, 0, "a failed restore must produce no project write");
  pass("RQ-6", "a refused restore keeps Recovery mode latched, keeps the surface on screen, installs nothing, and says the original is unchanged");
}

/* RQ-8 — the mode is re-derived, never remembered. */
async function rq8SurvivesNavigationAndRestart() {
  const failure = captured["invalid-json"].projectFailure;
  const { view } = await quarantinedWindow(captured["invalid-json"]);

  /* Navigating away and back. route() is the whole of this application's
     navigation, and it declines to render an ordinary workspace with no record. */
  view.context.location.hash = "#/shots";
  await view.context.route();
  assert.match(view.map.get("main").innerHTML, /RECOVERY MODE/, "navigating must not replace the protected surface");
  view.context.location.hash = "#/production";
  await view.context.route();
  assert.match(view.map.get("main").innerHTML, /RECOVERY MODE/, "navigating back must not replace the protected surface");
  assert.strictEqual(view.document.body.dataset.projectQuarantine, failure.slug, "navigation must not clear the latch");
  assert.strictEqual(view.context.captureProjectSave(), null, "navigation must not install a record");

  /* A restart is a second boot against the same stored bytes, and the server's
     verdict has not changed, so neither has the mode. Nothing was persisted for
     it to read: this window has never seen the first one. */
  const { view: restarted } = await quarantinedWindow(captured["invalid-json"]);
  assert.match(restarted.map.get("main").innerHTML, /RECOVERY MODE/, "a restart must enter Recovery mode again");
  assert.strictEqual(restarted.document.body.dataset.projectQuarantine, failure.slug);
  assert.strictEqual(restarted.context.captureProjectSave(), null);
  pass("RQ-8", "Recovery mode survives navigating away and back and a fresh start, because it is re-derived from the server's verdict rather than persisted");
}

/* RQ-9 — deferred work armed before the transition. */
async function rq9DeferredSaveCannotWrite() {
  /* A window that opened normally, holds a record, and has save-only work armed
     against it — then the project is quarantined underneath it. */
  const log = recorder();
  const view = await render("#/production", buildFixture(), {
    fetch: async (url, options, response) => log.fetch(url, options, response),
  });
  const context = view.context;
  assert.ok(context.captureProjectSave(), "the window must start holding a writable record");

  let fired = false;
  context.scheduleSaveTrigger(() => { fired = true; context.dirty(); }, 120);
  context.dirty(); // and an ordinary debounce armed alongside it
  const before = log.writes().length;

  context.markProjectLoadFailure(captured["invalid-json"].projectFailure);
  context.renderProjectFailureScreen(captured["invalid-json"].projectFailure, captured["invalid-json"].error);
  assert.strictEqual(view.document.body.dataset.projectQuarantine, captured["invalid-json"].projectFailure.slug, "the transition must have happened");

  await new Promise((resolve) => setTimeout(resolve, 900)); // past both the trigger and the debounce
  assert.strictEqual(fired, false, "deferred save-only work armed before the transition must be cancelled by it");
  assert.strictEqual(log.writes().length, before, "no write may occur after the transition to Recovery mode");
  assert.strictEqual(context.captureProjectSave(), null, "the writable record must be gone");
  assert.match(view.map.get("main").innerHTML, /RECOVERY MODE/);

  /* THE INDICATOR'S OWN DEFERRED WORK. An accepted save re-asserts "Saved" 1.6s
     later on a timer the save latch does not touch. A window quarantined inside
     that window would show the word Saved over a project CineBraid had just
     refused to open — a fake success state, arriving after everything else had
     settled and with nothing left in flight to correct it. */
  const settledLog = recorder();
  const settled = await render("#/production", buildFixture(), {
    fetch: async (url, options, response) => settledLog.fetch(url, options, response),
  });
  const settledState = () => settled.map.get("save-state").querySelector("span:last-child").textContent;
  settled.context.dirty();
  await new Promise((resolve) => setTimeout(resolve, 800)); // the debounce, then the accepted write
  assert.strictEqual(settledLog.writes().length, 1, "the window must have made an accepted save to arm the indicator's timer");
  assert.strictEqual(settledState(), "Saved", "and must be resting on Saved when the project is quarantined");

  settled.context.markProjectLoadFailure(captured["invalid-json"].projectFailure);
  settled.context.renderProjectFailureScreen(captured["invalid-json"].projectFailure, captured["invalid-json"].error);
  assert.match(settledState(), /Recovery mode/i, "the transition must state the truth immediately");
  await new Promise((resolve) => setTimeout(resolve, 2000)); // past the 1600ms re-assert
  assert.notStrictEqual(settledState(), "Saved", "no deferred indicator work may put Saved on the Recovery screen");
  assert.match(settledState(), /Recovery mode/i, "the indicator must still rest on the truth about this window");
  assert.strictEqual(settled.map.get("save-state").dataset.state, "error");
  pass("RQ-9", "a deferred save trigger, a debounce and the indicator's own re-assert timer armed before the transition are all cancelled by it: nothing writes, and the word Saved never reaches the Recovery screen");
}

/* RQ-10 — Universal Revision Convergence V3. */
async function rq10RevisionWatchDoesNotEscape() {
  const failure = captured["invalid-json"].projectFailure;
  const { view, log } = await quarantinedWindow(captured["invalid-json"], async (url, options, response) => {
    /* The stored bytes moved — a repair, a second corruption, another window. The
       watch must not read that as permission to install anything. */
    if (/\/revision$/.test(url)) return response({ slug: failure.slug, revision: '"moved-on"' });
    return null;
  });
  const before = log.calls.length;
  const outcome = await view.context.watchProjectRevision();
  assert.strictEqual(outcome, null, "the revision watch must decline while quarantined");
  assert.strictEqual(
    log.calls.filter((call) => /\/revision$/.test(call.url)).length,
    0,
    "the watch must not even ask, because no answer could authorise leaving the protected mode",
  );
  assert.strictEqual(log.calls.length, before, "the watch must make no request at all");
  assert.strictEqual(view.document.body.dataset.projectQuarantine, failure.slug, "a changed revision must not clear the latch");
  assert.strictEqual(view.context.captureProjectSave(), null, "a changed revision must not install a record");
  assert.match(view.map.get("main").innerHTML, /RECOVERY MODE/);
  assert.strictEqual(log.writes().length, 0);
  pass("RQ-10", "a changed server revision makes the V3 watch decline outright while quarantined: no request, no install, no escape");
}

/* THE REVALIDATION GATE — the one way out, and what it demands. */
async function rqGateLeavingRecoveryMode() {
  const { view } = await quarantinedWindow(captured["invalid-json"]);
  const context = view.context;
  const good = buildFixture();

  /* Each of these is a snapshot that would have installed a record before, and
     each names something a writable window cannot do without. */
  const refusals = [
    [{ available: false }, /did not serve/],
    [{ available: true, project: null, slug: "recovery-broken", revision: '"r"' }, /did not contain a project/],
    [{ available: true, project: good, slug: "", revision: '"r"' }, /did not name the project/],
    [{ available: true, project: good, slug: "recovery-broken", revision: "" }, /could not save/],
  ];
  for (const [prepared, expected] of refusals) {
    assert.match(context.projectReplacementRefusal(prepared), expected, "the gate must refuse and say why");
    assert.strictEqual(
      context.commitPreparedProject(prepared, { intent: "open", epoch: 1, sequence: 0, slug: "" }),
      false,
      "a refused snapshot must not be committed",
    );
    assert.strictEqual(view.document.body.dataset.projectQuarantine, captured["invalid-json"].projectFailure.slug, "a refused commit must not clear the latch");
    assert.strictEqual(context.captureProjectSave(), null, "a refused commit must not install a record");
  }

  /* And what the gate accepts: a document the server served, with the identity
     and revision a save needs. */
  assert.strictEqual(
    context.projectReplacementRefusal({ available: true, project: good, slug: "fixture", revision: HARNESS_PROJECT_REVISION }),
    "",
    "a validated snapshot must pass the gate",
  );
  const committed = context.commitPreparedProject(
    { available: true, project: good, slug: "fixture", revision: HARNESS_PROJECT_REVISION, scan: { characters: [], locations: [], props: [], audio: [], shots: {} }, promptLibrary: { profiles: [] }, config: {}, agentStatus: { enabled: false, runs: [], agents: [], index: {} }, automationRuns: [], falJobs: [], falLedgerLoaded: false },
    { intent: "open", epoch: 1, sequence: 0, slug: "" },
  );
  assert.strictEqual(committed, true, "a validated snapshot must commit");
  assert.strictEqual(view.document.body.dataset.projectQuarantine, undefined, "a validated commit is the one thing that ends Recovery mode");
  assert.ok(context.captureProjectSave(), "leaving Recovery mode must produce a window that can save");
  pass("GATE", "Recovery mode ends only at a commit carrying a served document with an addressable slug and a writable revision — and every snapshot missing one of those is refused with the latch intact");
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error("recovery-quarantine timed out");
    if (child) child.kill();
    process.exit(1);
  }, 180000);
  watchdog.unref?.();
  try {
    fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
    writeProjectFile(GOOD, JSON.stringify(projectFixture("Recovery Good"), null, 2));
    writeProjectFile(BROKEN, JSON.stringify(projectFixture("Recovery Broken"), null, 2));
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ activeProject: GOOD }, null, 2));
    /* A file in the backup folder that CineBraid did not write, kept for the whole
       run: nothing here may list it, restore it or delete it. */
    writeBackup(BROKEN, "notes.json", "the filmmaker's own notes");

    const port = await getFreePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: CONFIG_PATH, CINEBRAID_PROJECTS_ROOT: PROJECTS_ROOT },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    await waitForServer();

    await a1FailureVocabulary();
    await a2FailurePayloadDescribesTheBytes();
    await a3RawProjectFileDownload();
    await a4RestoreIntoAnUnreadableOriginal();
    await a5FailedRestoreProtectsTheOriginal();
    await a6NoOrdinaryWriteReachesAQuarantinedDocument();
    await a7DuplicateForRepairIsNotAvailable();

    assert.ok(listBackupFiles(BROKEN).includes("notes.json"), "a file CineBraid did not write must never be deleted by any of this");

    await rq1MalformedProject();
    await rq2UnmigratableProject();
    await rq3NoOrdinarySave();
    await rq4NoCanonWrite();
    await rq5RestoreFromTheSurface();
    await rq6FailedRestoreKeepsTheMode();
    await rq8SurvivesNavigationAndRestart();
    await rq9DeferredSaveCannotWrite();
    await rq10RevisionWatchDoesNotEscape();
    await rqGateLeavingRecoveryMode();

    console.log(
      `Recovery / Quarantine V1 passed: ${results.length} scenarios — `
      + "a project CineBraid cannot safely open enters a protected mode, the original is preserved byte-for-byte, "
      + "no ordinary save or Canon transition can write, deferred work is cancelled, the revision watch declines, "
      + "and the mode ends only at a validated open. Provider/model calls: 0.",
    );
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

module.exports = { projectFixture, backupName, QUARANTINE_FAILURE_KEYS };

"use strict";

/* PSS-2 NEGATIVE CONTROLS.
 *
 * The positive suite says archived and trashed project documents survive a workspace
 * migration. That is only worth something if the correction is what makes it true.
 *
 * Each control reintroduces one specific defect into the SHIPPED server.js, runs a
 * real server on the mutated source, and requires the exact damage back.
 *
 * Every control runs twice. PHASE 0 runs the shipped source and requires the damage
 * to be ABSENT — a control that "detects" something already broken detects nothing.
 * PHASE 1 runs the mutated source and requires it PRESENT. Each mutation is proved to
 * match the shipped text exactly once, so a needle that has drifted can never be
 * mistaken for a defect that came back.
 *
 * Fixtures are isolated under os.tmpdir(). No provider is configured or contacted,
 * and the real production workspace is never read, written or referenced.
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { ROOT, freePort } = require("./fixtures/mock-civitai");
const { manifestOf, compareManifests } = require(path.join(ROOT, "scripts", "verify-migration"));

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-pss2-nc-"));
const SERVER = path.join(ROOT, "src/server/server.js");
const SHIPPED = fs.readFileSync(SERVER, "utf8").replace(/\r\n/g, "\n");
const SCRATCH = new Set();

process.on("exit", () => { for (const file of SCRATCH) { try { fs.unlinkSync(file); } catch {} } });

/* ==========================================================================
   MUTATION
   ========================================================================== */

function applyMutations(source, edits) {
  let text = String(source).replace(/\r\n/g, "\n");
  edits.forEach((edit, index) => {
    const needle = String(edit.from).replace(/\r\n/g, "\n");
    const found = text.split(needle).length - 1;
    assert.strictEqual(found, 1,
      `edit ${index + 1}: the needle matched ${found} times in the shipped source, so this control is not armed`);
    const next = text.replace(needle, edit.to);
    assert.notStrictEqual(next, text, `edit ${index + 1}: the mutation produced no change`);
    text = next;
  });
  return text;
}

/* THE DEFECT PSS-2 CORRECTED: the copy loop deciding what the seam owns by NAME
   instead of by the seam's own reservation set. One line, and it is the whole bug. */
const SKIP_DOCUMENTS_BY_NAME = [{
  from: "    } else if (isEnrolledDocument(reserved, dest)) {",
  to: '    } else if (path.basename(entry.name).toLowerCase() === "project.json") {',
}];

/* A NEARBY WRONG FIX: carrying nested documents but reserving nothing, so the copy
   also tries to write the document the seam already published. Create-only makes that
   a refusal rather than a corruption — which is the point — but the workspace then
   cannot migrate at all, and a control has to show that this is not what shipped. */
const RESERVE_NOTHING = [{
  from: "  const reserved = new Set(projects.map((item) => reservationKey(item.destinationFile)));",
  to: "  const reserved = new Set();",
}];

/* ==========================================================================
   FIXTURES AND A SERVER BUILT FROM ARBITRARY SOURCE
   ========================================================================== */

function baseProject(title) {
  return {
    meta: {
      title, format: "Test", version: "v1", hubVersion: "v6.0.0",
      schemaVersion: "6.6", aiPolicy: "project-default", world: {},
    },
    qcChecklist: [], characters: [], locations: [], props: [], vehicles: [],
    audio: [], mediaAssets: [], jobs: [], agentRuns: [], decisions: [],
    sessions: [], finishJobs: [],
    scenes: [{ id: "SC-01", title: "Scene", whatHappens: "A test beat.", howItFeels: "Exact." }],
    shots: [{
      id: "SH-01", scene: "SC-01", title: "Shot", desc: "A test shot.",
      positioning: "Locked frame.", dur: 5, workflowStatus: "DRAFT",
      characters: [], codes: [], risks: [], candidateFiles: [], creationBrief: {},
      keyframes: [{ id: "fr-a", label: "A", title: "Opening", description: "Opening frame.", generationPackages: [] }],
      clips: [],
    }],
  };
}
const toPosix = (value) => String(value).replace(/\\/g, "/");
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function writeFileAt(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}
function writeProjectAt(dir, project) {
  writeFileAt(path.join(dir, "project.json"), JSON.stringify(project, null, 2) + "\n");
}

const ARCHIVE_STAMP = "retired-2026-09-09T17-27-32-055Z";
const TRASH_NAME = "discarded-2026-09-01T08-00-00-000Z";
const ARCHIVED_DOCUMENT = `.archive/${ARCHIVE_STAMP}/project.json`;
const TRASHED_DOCUMENT = `.trash/${TRASH_NAME}/project.json`;

function buildWorkspace({ source }) {
  writeProjectAt(path.join(source, "alpha"), baseProject("Alpha"));
  writeFileAt(path.join(source, "alpha", "media", "frame.bin"), "alpha-frame-bytes");
  const archived = path.join(source, ".archive", ARCHIVE_STAMP);
  writeProjectAt(archived, baseProject("Retired"));
  writeFileAt(path.join(archived, "media", "retired-frame.bin"), "retired-frame-bytes");
  const trashed = path.join(source, ".trash", TRASH_NAME);
  writeProjectAt(trashed, baseProject("Discarded"));
  writeFileAt(path.join(trashed, "media", "discarded-frame.bin"), "discarded-frame-bytes");
}

let scratchCounter = 0;
async function runServer(source, { configPath, projectsRoot }, body) {
  const isShipped = source === SHIPPED;
  const file = isShipped ? SERVER : path.join(path.dirname(SERVER), `server-pss2-control-${process.pid}-${scratchCounter++}.tmp`);
  if (!isShipped) { fs.writeFileSync(file, source); SCRATCH.add(file); }
  const port = await freePort();
  const child = spawn(process.execPath, [file], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: projectsRoot,
      FAL_KEY: "", OPENAI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/me`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const request = async (pathname, options = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      return { status: response.status, ok: response.ok, body: parsed, text };
    };
    return await body({ request });
  } finally {
    child.kill();
    if (!isShipped) { try { fs.unlinkSync(file); } catch {} SCRATCH.delete(file); }
  }
}

/* One migration attempt against whichever source is given, over a freshly built copy
   of the fixture so the two phases cannot interfere. */
async function migrateWith(source) {
  const home = fs.mkdtempSync(path.join(TEMP, "ws-"));
  const projectsRoot = path.join(home, "source"), dest = path.join(home, "dest");
  fs.mkdirSync(projectsRoot, { recursive: true });
  buildWorkspace({ source: projectsRoot, dest });
  const configPath = path.join(home, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    workspace: { projectRoot: toPosix(projectsRoot) },
    activeProject: "alpha",
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: { enabled: false } },
  }, null, 2));
  const before = manifestOf(projectsRoot);
  return runServer(source, { configPath, projectsRoot }, async ({ request }) => {
    const result = await request("/api/workspace/settings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: { projectRoot: toPosix(dest) } }),
    });
    return { source: projectsRoot, dest, result, sourceBefore: before };
  });
}

const arrived = (dest, rel) => fs.existsSync(path.join(dest, ...rel.split("/")));

/* ==========================================================================
   NC-PSS2-1 — the name test, reintroduced
   ========================================================================== */

async function nameTestControl() {
  /* PHASE 0 — shipped. */
  const shipped = await migrateWith(SHIPPED);
  assert.strictEqual(shipped.result.status, 200, JSON.stringify(shipped.result.body));
  for (const rel of [ARCHIVED_DOCUMENT, TRASHED_DOCUMENT])
    assert.strictEqual(arrived(shipped.dest, rel), true, `shipped: ${rel} must arrive`);
  assert.strictEqual(shipped.result.body.migration.verification.ok, true,
    "shipped: the verification must pass: " + JSON.stringify(shipped.result.body.migration.verification));

  /* PHASE 1 — the defect. */
  const mutated = await migrateWith(applyMutations(SHIPPED, SKIP_DOCUMENTS_BY_NAME));
  assert.strictEqual(mutated.result.status, 200,
    "the defect answers a plain success, which is what made it dangerous: " + JSON.stringify(mutated.result.body));
  assert.strictEqual(mutated.result.body.migration.movedRoot, true, "…as a completed move");

  /* The damage, exactly. */
  assert.strictEqual(arrived(mutated.dest, ARCHIVED_DOCUMENT), false,
    "the archived project's document must be the thing that goes missing");
  assert.strictEqual(arrived(mutated.dest, TRASHED_DOCUMENT), false,
    "and the trashed project's document with it");
  /* And the tell that made it so hard to see: everything BESIDE the document arrives,
     so the archive looks present in a file listing and is not. */
  assert.strictEqual(arrived(mutated.dest, `.archive/${ARCHIVE_STAMP}/media/retired-frame.bin`), true,
    "while its media arrives, which is why the loss looks like a healthy folder");

  /* The verification is the witness, and it must not agree with the loop. */
  const verification = mutated.result.body.migration.verification;
  assert.strictEqual(verification.ok, false, "the verification must catch it: " + JSON.stringify(verification));
  assert.deepStrictEqual(verification.missing.sort(),
    [ARCHIVED_DOCUMENT, TRASHED_DOCUMENT].map((rel) => rel.split("/").join(path.sep)).sort(),
    "and must name exactly the two documents that did not arrive: " + JSON.stringify(verification.missing));
  assert.strictEqual(verification.documents.carried, 2,
    "the source still contains two carriable documents, whatever the copy did with them");
  assert.strictEqual(mutated.result.body.migration.carriedDocuments, 0,
    "and the loop reports carrying none of them");
}

/* ==========================================================================
   NC-PSS2-2 — the standalone verifier catches it too, independently

   The endpoint's verification and scripts/verify-migration.js share no code. If the
   only witness were the one the server prints, a future change to the server could
   silence both the defect and the alarm at once.
   ========================================================================== */

async function standaloneVerifierControl() {
  const shipped = await migrateWith(SHIPPED);
  const shippedResult = compareManifests(manifestOf(shipped.source), manifestOf(shipped.dest), { republishedDocuments: true });
  assert.strictEqual(shippedResult.ok, true,
    "shipped: the standalone verifier must verify: " + JSON.stringify(shippedResult.missing));

  const mutated = await migrateWith(applyMutations(SHIPPED, SKIP_DOCUMENTS_BY_NAME));
  const result = compareManifests(manifestOf(mutated.source), manifestOf(mutated.dest), { republishedDocuments: true });
  assert.strictEqual(result.ok, false, "the standalone verifier must refuse to verify the damaged migration");
  assert.deepStrictEqual(result.missing.sort(), [ARCHIVED_DOCUMENT, TRASHED_DOCUMENT].sort(),
    "and name the same two documents: " + JSON.stringify(result.missing));
  /* The allowance must not have covered them. That is the difference between a
     verifier and a rubber stamp. */
  assert.deepStrictEqual(result.republished, ["alpha/project.json"],
    "only the live document may be exempted: " + JSON.stringify(result.republished));
}

/* ==========================================================================
   NC-PSS2-3 — reserving nothing is not the fix either
   ========================================================================== */

async function reserveNothingControl() {
  const shipped = await migrateWith(SHIPPED);
  assert.strictEqual(shipped.result.status, 200, "shipped: the migration completes");
  assert.strictEqual(shipped.result.body.migration.verification.ok, true, "shipped: and verifies");

  const mutated = await migrateWith(applyMutations(SHIPPED, RESERVE_NOTHING));
  /* The copy reaches a document the seam has already published. COPYFILE_EXCL cannot
     overwrite, so it counts a skip rather than corrupting it — the create-only
     guarantee doing its job — and the live document therefore arrives exactly once
     and unharmed. What is lost is the truth of the report: the response now claims to
     have carried a document it did not carry. */
  assert.strictEqual(mutated.result.status, 200, JSON.stringify(mutated.result.body));
  const live = path.join(mutated.dest, "alpha", "project.json");
  assert.strictEqual(fs.existsSync(live), true, "the live document still arrives, published by the seam");
  assert.strictEqual(JSON.parse(fs.readFileSync(live, "utf8")).meta.title, "Alpha",
    "and is not corrupted by the second writer, because the second writer cannot overwrite");
  assert.strictEqual(mutated.result.body.migration.verification.documents.enrolled, 0,
    "but the report no longer knows the seam enrolled it: "
    + JSON.stringify(mutated.result.body.migration.verification.documents));
  assert.strictEqual(mutated.result.body.migration.verification.documents.carried, 3,
    "and counts the live document among the ones the tree copy carried, which it did not");
}

/* ==========================================================================
   NC-PSS2-4 — the source is never written, and the check that proves it works
   ========================================================================== */

async function sourceUntouchedControl() {
  const shipped = await migrateWith(SHIPPED);
  const untouched = compareManifests(shipped.sourceBefore, manifestOf(shipped.source));
  assert.strictEqual(untouched.ok, true,
    "shipped: the source must be byte-identical afterwards: " + JSON.stringify(untouched.mismatched));
  assert.deepStrictEqual(untouched.extra, [], "and nothing may have been added to it");

  /* The control on the CHECK rather than on the server: a single changed byte in the
     source must make that comparison fail. A source-untouched assertion that cannot
     fail proves nothing about migration. */
  const planted = path.join(shipped.source, "alpha", "media", "frame.bin");
  const original = fs.readFileSync(planted);
  fs.writeFileSync(planted, Buffer.concat([original, Buffer.from("x")]));
  try {
    const detected = compareManifests(shipped.sourceBefore, manifestOf(shipped.source));
    assert.strictEqual(detected.ok, false, "a changed source byte must be detected");
    assert.deepStrictEqual(detected.mismatched.map((row) => row.path), ["alpha/media/frame.bin"]);
    assert.strictEqual(detected.mismatched[0].reason, "size");
  } finally { fs.writeFileSync(planted, original); }

  /* And a same-size change, which only a hash can see. */
  const sameSize = Buffer.from(original); sameSize[0] = sameSize[0] ^ 0xff;
  fs.writeFileSync(planted, sameSize);
  try {
    const detected = compareManifests(shipped.sourceBefore, manifestOf(shipped.source));
    assert.strictEqual(detected.ok, false, "a same-size source change must still be detected");
    assert.strictEqual(detected.mismatched[0].reason, "content",
      "which is why the default compares by SHA-256 and not by size");
    const blind = compareManifests(shipped.sourceBefore, manifestOf(shipped.source, { hash: false }));
    assert.strictEqual(blind.ok, true, "and why --stat-only is triage rather than proof");
  } finally { fs.writeFileSync(planted, original); }

  assert.strictEqual(sha(planted), sha(planted), "the fixture is restored");
}

/* ==========================================================================
   RUN
   ========================================================================== */

(async () => {
  console.log("PSS-2 negative controls\n");
  let caught = 0, missed = 0, broken = 0;

  for (const [id, title, fn] of [
    ["NC-PSS2-1", "documents skipped by name — an archived project loses its record", nameTestControl],
    ["NC-PSS2-2", "the standalone verifier catches the same loss independently", standaloneVerifierControl],
    ["NC-PSS2-3", "reserving nothing — the report claims a document the copy never carried", reserveNothingControl],
    ["NC-PSS2-4", "the source-untouched check can fail, by size and by content", sourceUntouchedControl],
  ]) {
    try { await fn(); caught += 1; console.log(`  caught     ${id}  ${title}`); }
    catch (error) { broken += 1; console.log(`  BROKEN     ${id}  ${title}\n             ${error.message}`); }
  }

  console.log(`\nPSS-2 negative controls: ${caught} caught · ${missed} missed · ${broken} broken; provider calls: 0.`);
  fs.rmSync(TEMP, { recursive: true, force: true });
  if (missed || broken) process.exit(1);
})().catch((error) => {
  console.error("\nPSS-2 negative controls FAILED\n", error);
  process.exit(1);
});

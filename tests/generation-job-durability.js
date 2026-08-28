/* Generation-job ledger durability.
 *
 * F-17: `generation-jobs.json` was read with `try { ... } catch { return []; }`,
 * so a corrupt ledger was indistinguishable from a project that had never
 * generated. The consequences were all silent: the concurrency guard saw zero
 * active jobs and freed every slot, and the next ordinary Generate rewrote the
 * file — persisting `[]` over a history whose provider request ids were the only
 * record that money had been spent.
 *
 * A MISSING ledger is normal. A CORRUPT ledger is not an empty ledger. This
 * suite holds that line at both levels: the store in isolation, and the running
 * server whose next action must not be able to erase a recovered history.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { withGenerationDeclaration } = require("./generation-request-fixture");

const ROOT = path.join(__dirname, "..");
const {
  readJobLedger,
  writeJobLedgerSync,
  JobLedgerUnreadableError,
  jobsPath,
  backupPath,
} = require(path.join(ROOT, "generation-job-store"));

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "cinebraid-jobdur-"));

function freshDir(name) {
  const dir = path.join(TEMP, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function paidJob(id = "fal-job-paid") {
  return {
    id,
    provider: "fal",
    purpose: "frame",
    shotId: "S-01",
    status: "COMPLETED",
    externalId: "req-paid-123",
    statusUrl: "https://queue.example/status/req-paid-123",
    responseUrl: "https://queue.example/result/req-paid-123",
    outputs: [{ type: "candidate", name: "S-01_FRAME_A_FAL_1.png" }],
    ingestedAt: "2026-08-08T00:00:00.000Z",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

/* ---------- 1. the store in isolation ---------- */
function storeChecks() {
  /* A missing ledger is the normal pre-first-generation state. */
  const missing = freshDir("missing");
  const empty = readJobLedger(missing);
  assert.deepStrictEqual(empty.jobs, [], "a missing ledger reads as an empty list");
  assert.strictEqual(empty.exists, false, "a missing ledger reports that it does not exist");
  assert.strictEqual(empty.recovered, false, "a missing ledger is not a recovery");
  assert(!fs.existsSync(jobsPath(missing)), "reading must not create a ledger file");

  /* A valid primary reads back exactly. */
  const valid = freshDir("valid");
  writeJobLedgerSync(valid, [paidJob()]);
  const read = readJobLedger(valid);
  assert.strictEqual(read.jobs.length, 1, "a valid ledger reads its rows");
  assert.strictEqual(read.recovered, false, "a valid primary is not a recovery");
  assert.strictEqual(read.jobs[0].externalId, "req-paid-123", "the provider request id survives a round trip");

  /* The document on disk stays a bare array — existing ledgers keep working. */
  const raw = JSON.parse(fs.readFileSync(jobsPath(valid), "utf8"));
  assert(Array.isArray(raw), "the stored document must remain a plain job array");

  /* A second write promotes the previous primary to `.bak`. */
  writeJobLedgerSync(valid, [paidJob(), { ...paidJob("fal-job-two"), externalId: "req-paid-456" }]);
  assert(fs.existsSync(backupPath(valid)), "a write must leave a backup of the previous ledger");
  assert.strictEqual(JSON.parse(fs.readFileSync(backupPath(valid), "utf8")).length, 1, "the backup holds the previous ledger");

  /* Corrupt primary + valid backup -> recovery, not an empty list. */
  const corrupt = freshDir("corrupt-primary");
  writeJobLedgerSync(corrupt, [paidJob()]);
  fs.copyFileSync(jobsPath(corrupt), backupPath(corrupt));
  fs.writeFileSync(jobsPath(corrupt), "{ this is not json");
  const recovered = readJobLedger(corrupt);
  assert.strictEqual(recovered.recovered, true, "a corrupt primary with a valid backup is a recovery");
  assert.strictEqual(recovered.jobs.length, 1, "the recovered ledger holds the previous history");
  assert.strictEqual(recovered.jobs[0].externalId, "req-paid-123", "a recovered job keeps its provider request id");
  assert.strictEqual(recovered.jobs[0].status, "COMPLETED", "a recovered job keeps its status");
  assert(recovered.warning, "a recovery must say so");

  /* A truncated write — a crash mid-write — recovers the same way. */
  const truncated = freshDir("truncated-primary");
  writeJobLedgerSync(truncated, [paidJob()]);
  fs.copyFileSync(jobsPath(truncated), backupPath(truncated));
  const good = fs.readFileSync(jobsPath(truncated), "utf8");
  fs.writeFileSync(jobsPath(truncated), good.slice(0, Math.floor(good.length * 0.6)));
  const fromTruncated = readJobLedger(truncated);
  assert.strictEqual(fromTruncated.recovered, true, "a truncated primary recovers from the backup");
  assert.strictEqual(fromTruncated.jobs[0].externalId, "req-paid-123", "a truncated primary does not cost the request id");

  /* A ledger that parses but is not an array is corruption too, not an empty list. */
  const wrongShape = freshDir("wrong-shape");
  writeJobLedgerSync(wrongShape, [paidJob()]);
  fs.copyFileSync(jobsPath(wrongShape), backupPath(wrongShape));
  fs.writeFileSync(jobsPath(wrongShape), JSON.stringify({ jobs: [] }, null, 2));
  assert.strictEqual(readJobLedger(wrongShape).recovered, true, "a non-array document is corruption, not an empty ledger");

  /* A write over a CORRUPT primary must not promote it over a good backup. */
  const protectBackup = freshDir("protect-backup");
  writeJobLedgerSync(protectBackup, [paidJob()]);
  fs.copyFileSync(jobsPath(protectBackup), backupPath(protectBackup));
  fs.writeFileSync(jobsPath(protectBackup), "corrupted beyond parsing");
  const before = fs.readFileSync(backupPath(protectBackup), "utf8");
  writeJobLedgerSync(protectBackup, [paidJob(), paidJob("fal-job-new")]);
  assert.strictEqual(
    fs.readFileSync(backupPath(protectBackup), "utf8"), before,
    "a corrupt primary must never overwrite a good backup",
  );
  assert.strictEqual(readJobLedger(protectBackup).jobs.length, 2, "the new ledger is readable after the write");

  /* Both copies unreadable -> a typed refusal. Neither file is touched. */
  const bothCorrupt = freshDir("both-corrupt");
  fs.writeFileSync(jobsPath(bothCorrupt), "{ broken");
  fs.writeFileSync(backupPath(bothCorrupt), "also broken");
  const primaryBytes = fs.readFileSync(jobsPath(bothCorrupt), "utf8");
  const backupBytes = fs.readFileSync(backupPath(bothCorrupt), "utf8");
  assert.throws(
    () => readJobLedger(bothCorrupt),
    (error) => error instanceof JobLedgerUnreadableError && error.code === "GENERATION_LEDGER_UNREADABLE",
    "two unreadable copies must refuse, never return an empty ledger",
  );
  assert.strictEqual(fs.readFileSync(jobsPath(bothCorrupt), "utf8"), primaryBytes, "a refusal must leave the primary untouched");
  assert.strictEqual(fs.readFileSync(backupPath(bothCorrupt), "utf8"), backupBytes, "a refusal must leave the backup untouched");

  /* A corrupt primary with no backup at all is still a refusal, not a fresh start. */
  const noBackup = freshDir("corrupt-no-backup");
  fs.writeFileSync(jobsPath(noBackup), "{ broken and alone");
  assert.throws(
    () => readJobLedger(noBackup),
    (error) => error instanceof JobLedgerUnreadableError,
    "a corrupt ledger with no backup must refuse rather than silently start over",
  );

  /* A BOM is what Windows editors leave behind and must not be corruption. */
  const bom = freshDir("bom");
  fs.writeFileSync(jobsPath(bom), "﻿" + JSON.stringify([paidJob()], null, 2));
  assert.strictEqual(readJobLedger(bom).jobs.length, 1, "a UTF-8 BOM must not make a ledger unreadable");
}

/* ---------- 2. the running server ---------- */
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
function projectFixture(title) {
  return {
    meta: { title, format: "Test", version: "v1", hubVersion: "v6.0.0", aiPolicy: "project-default" },
    qcChecklist: [],
    scenes: [{ id: "SC-01", title: "Scene one" }],
    shots: [{ id: "S-01", scene: "SC-01", title: "Shot one", dur: 5, workflowStatus: "DRAFT", keyframes: [], clips: [], candidateFiles: [] }],
    characters: [], locations: [], props: [], vehicles: [], audio: [],
    mediaAssets: [], jobs: [], agentRuns: [], decisions: [], sessions: [],
  };
}

async function serverChecks() {
  const SLUG = "durability-project";
  const projectsRoot = path.join(TEMP, "server-projects");
  const projectDir = path.join(projectsRoot, SLUG);
  const configPath = path.join(TEMP, "server-config.json");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(projectFixture("Durability"), null, 2));
  fs.writeFileSync(configPath, JSON.stringify({
    activeProject: SLUG,
    assistant: { provider: "none", visionProvider: "none" },
    generation: { fal: { enabled: true, apiKey: "test-key", baseUrl: "http://127.0.0.1:9/unused", maxConcurrent: 2 } },
  }, null, 2));

  /* A ledger holding one paid, externally-identified job, in both copies. */
  const history = [paidJob()];
  fs.writeFileSync(jobsPath(projectDir), JSON.stringify(history, null, 2));
  fs.writeFileSync(backupPath(projectDir), JSON.stringify(history, null, 2));

  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: projectsRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));

  const request = async (url, options) => {
    const response = await fetch(base + url, options);
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const postJson = (url, payload) =>
    request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(withGenerationDeclaration(url, payload)) });

  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      try { if ((await fetch(base + "/api/me")).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`Server did not start:\n${output}`);
      await new Promise((r) => setTimeout(r, 60));
    }

    const healthy = await request("/api/generation/fal/jobs");
    assert.strictEqual(healthy.status, 200, "the valid ledger must be served");
    assert.strictEqual(healthy.body.jobs.length, 1, "the paid job must be visible before corruption");

    /* Corrupt the primary the way a crash mid-write does. */
    const good = fs.readFileSync(jobsPath(projectDir), "utf8");
    fs.writeFileSync(jobsPath(projectDir), good.slice(0, Math.floor(good.length * 0.6)));

    const afterCorruption = await request("/api/generation/fal/jobs");
    assert.strictEqual(afterCorruption.status, 200, "a recoverable ledger must still be served");
    assert.strictEqual(afterCorruption.body.jobs.length, 1, "a corrupt primary must NOT read as an empty history");
    assert.strictEqual(afterCorruption.body.jobs[0].externalId, "req-paid-123", "the recovered job keeps its provider request id");
    assert.strictEqual(afterCorruption.body.jobs[0].status, "COMPLETED", "the recovered job keeps its status");

    /* An ordinary next action must not be able to erase the recovered history.
       The provider address is a closed port, so the submit fails — but the
       ledger write happens first and is exactly what used to destroy history. */
    const submit = await postJson("/api/generation/fal/jobs", {
      purpose: "frame", shotId: "S-01", prompt: "an ordinary next generation", outputCount: 1,
    });
    assert([200, 502].includes(submit.status), `submit answered unexpectedly: ${submit.status} ${JSON.stringify(submit.body)}`);

    const persisted = readJobLedger(projectDir).jobs;
    assert(
      persisted.some((job) => job.externalId === "req-paid-123"),
      "a generation after corruption must not erase the previous paid record",
    );
    assert(persisted.length >= 2, "the new job is appended to the recovered history rather than replacing it");
    assert.strictEqual(
      JSON.parse(fs.readFileSync(jobsPath(projectDir), "utf8")).length, persisted.length,
      "the durable file matches what the store reports",
    );

    /* Both copies unreadable: a typed refusal that names the file, and no write. */
    fs.writeFileSync(jobsPath(projectDir), "{ broken");
    fs.writeFileSync(backupPath(projectDir), "also broken");
    const primaryBytes = fs.readFileSync(jobsPath(projectDir), "utf8");
    const refused = await request("/api/generation/fal/jobs");
    assert.strictEqual(refused.status, 409, "an unreadable ledger must refuse, not answer with an empty list");
    assert.strictEqual(refused.body.code, "GENERATION_LEDGER_UNREADABLE", "the refusal must be typed");
    assert(refused.body.error && /generation-jobs\.json/.test(refused.body.error), "the refusal must name the file");

    const refusedSubmit = await postJson("/api/generation/fal/jobs", {
      purpose: "frame", shotId: "S-01", prompt: "must not start over", outputCount: 1,
    });
    assert.strictEqual(refusedSubmit.status, 409, "a generation against an unreadable ledger must refuse");
    assert.strictEqual(
      fs.readFileSync(jobsPath(projectDir), "utf8"), primaryBytes,
      "a refused generation must leave the unreadable ledger untouched",
    );
  } finally {
    child.kill();
  }

  /* ---- restart stability: a recovered ledger survives a fresh process ---- */
  fs.writeFileSync(jobsPath(projectDir), JSON.stringify(history, null, 2));
  fs.writeFileSync(backupPath(projectDir), JSON.stringify(history, null, 2));
  fs.writeFileSync(jobsPath(projectDir), "{ truncated again");

  const restartPort = await getFreePort();
  const restartBase = `http://127.0.0.1:${restartPort}`;
  let restartOutput = "";
  const restarted = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(restartPort), CINEBRAID_CONFIG_PATH: configPath, CINEBRAID_PROJECTS_ROOT: projectsRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  restarted.stdout.on("data", (d) => (restartOutput += d));
  restarted.stderr.on("data", (d) => (restartOutput += d));
  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      try { if ((await fetch(restartBase + "/api/me")).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`Server did not restart:\n${restartOutput}`);
      await new Promise((r) => setTimeout(r, 60));
    }
    const afterRestart = await fetch(restartBase + "/api/generation/fal/jobs").then((r) => r.json());
    assert.strictEqual(afterRestart.jobs.length, 1, "a recovered ledger survives a restart");
    assert.strictEqual(afterRestart.jobs[0].externalId, "req-paid-123", "the recovered job keeps its request id across a restart");
  } finally {
    restarted.kill();
  }
}

async function main() {
  storeChecks();
  await serverChecks();
  console.log(
    "Generation-job durability suite passed missing/valid/corrupt-primary/truncated/wrong-shape/both-corrupt reads, "
    + "BOM tolerance, backup protection against a corrupt primary, typed refusal with both copies unreadable, "
    + "recovered history surviving an ordinary next generation, and restart stability after a recovery.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

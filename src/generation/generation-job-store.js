/* CineBraid generation-job ledger — durable persistence.
 *
 * `projects/<slug>/generation-jobs.json`, brought to the same safety class as
 * media-asset-store.js and automation-runs.js: an atomic temp-then-rename, a
 * `.bak` taken before the primary is replaced, read-side recovery from that
 * backup, and a REFUSAL when both copies are unreadable.
 *
 * What this replaces is one line in fal-generation.js:
 *
 *     function readJobs() { try { ... } catch { return []; } }
 *
 * A missing ledger is normal — a project that has never generated has no file,
 * and that reads as an empty list. A CORRUPT ledger is not an empty ledger. The
 * old catch-all made them indistinguishable, and every consequence flowed from
 * that: the concurrency guard saw zero active jobs and freed every slot, the
 * Generate button re-dispatched paid work, and the next write persisted `[]`
 * over a history containing provider request ids that were the only record that
 * money had been spent. Losing the ledger loudly is recoverable; losing it
 * silently is not.
 *
 * The document on disk stays a bare JSON array. Existing ledgers are read and
 * rewritten unchanged — this adds durability, not a schema.
 */

const fs = require("fs");
const path = require("path");

const JOBS_FILE = "generation-jobs.json";

function jobsPath(projectDir) {
  return path.join(projectDir, JOBS_FILE);
}
function backupPath(projectDir) {
  return `${jobsPath(projectDir)}.bak`;
}

class JobLedgerUnreadableError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "JobLedgerUnreadableError";
    this.code = "GENERATION_LEDGER_UNREADABLE";
    this.status = 409;
    this.detail = detail || {};
  }
}

/* A BOM is what PowerShell's Out-File and Notepad leave behind, and every other
   JSON reader in this repository tolerates one. */
function parseJobs(target) {
  const parsed = JSON.parse(String(fs.readFileSync(target, "utf8")).replace(/^﻿/, ""));
  if (!Array.isArray(parsed)) throw new Error("generation-jobs.json is not a job array.");
  return parsed;
}

/* Reads the generation-job ledger for one project directory.

   Returns { jobs, exists, recovered, warning }.

     missing          -> [], exists:false. NORMAL, not an error.
     primary valid    -> the primary
     primary corrupt  -> the backup, recovered:true, with a warning
     both corrupt     -> THROWS JobLedgerUnreadableError                        */
function readJobLedger(projectDir) {
  const target = jobsPath(projectDir);
  const backup = backupPath(projectDir);

  let primaryError = null;
  try {
    return { jobs: parseJobs(target), exists: true, recovered: false, warning: "" };
  } catch (error) {
    if (error?.code === "ENOENT") {
      /* No ledger yet. Every project is in this state before its first
         generation, and every reader must tolerate it. */
      return { jobs: [], exists: false, recovered: false, warning: "" };
    }
    primaryError = error;
  }

  try {
    const jobs = parseJobs(backup);
    return {
      jobs,
      exists: true,
      recovered: true,
      warning: "generation-jobs.json was unreadable; CineBraid loaded its backup copy.",
    };
  } catch (backupError) {
    if (backupError?.code === "ENOENT") {
      /* A corrupt primary with no backup at all. Still a refusal: the file
         exists and holds bytes we could not read, and treating that as "no
         generation history" is exactly the silent loss this store exists to
         prevent. */
      throw new JobLedgerUnreadableError(
        "generation-jobs.json is unreadable and has no backup copy. CineBraid will not treat that as an empty "
        + "generation history, because doing so would hide paid provider requests and free every concurrency slot. "
        + "The file has been left untouched.",
        { path: target, backupPath: backup, primary: String(primaryError?.message || primaryError), backup: "missing" },
      );
    }
    throw new JobLedgerUnreadableError(
      "generation-jobs.json and its backup are both unreadable. CineBraid will not treat that as an empty "
      + "generation history, because doing so would hide paid provider requests and free every concurrency slot. "
      + "Both files have been left untouched.",
      {
        path: target,
        backupPath: backup,
        primary: String(primaryError?.message || primaryError),
        backup: String(backupError?.message || backupError),
      },
    );
  }
}

function writeJobLedgerSync(projectDir, jobs) {
  if (!Array.isArray(jobs)) throw new Error("Refusing to persist a generation ledger that is not an array.");

  const target = jobsPath(projectDir);
  const backup = backupPath(projectDir);
  fs.mkdirSync(projectDir, { recursive: true });

  const payload = JSON.stringify(jobs, null, 2);
  JSON.parse(payload); // never rename a temp file we cannot read back

  const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    /* The backup is taken BEFORE the primary is replaced, so a crash between the
       two leaves a readable previous ledger rather than nothing.

       Only a primary that still PARSES is promoted to backup. Copying an
       unreadable primary over a good backup would destroy the one copy recovery
       depends on — the precise moment recovery matters most. */
    if (fs.existsSync(target)) {
      let primaryReadable = true;
      try { parseJobs(target); } catch { primaryReadable = false; }
      if (primaryReadable) fs.copyFileSync(target, backup);
    }
    fs.renameSync(temp, target);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    /* A crash before the rename leaves only the temp file. The primary is
       untouched, so the ledger on disk is whatever it was. */
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    throw error;
  }
  return { path: target, bytes: Buffer.byteLength(payload, "utf8") };
}

module.exports = {
  JOBS_FILE,
  JobLedgerUnreadableError,
  backupPath,
  jobsPath,
  readJobLedger,
  writeJobLedgerSync,
};

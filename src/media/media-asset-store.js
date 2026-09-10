/* CineBraid MediaAsset ledger — durable persistence.
 *
 * `projects/<slug>/media-assets.json`, written the way automation-runs.js writes:
 * a schema version on the document, an atomic temp-then-rename, a `.bak` taken
 * before the primary is replaced, and read-side recovery from that backup.
 *
 * It deliberately does NOT write the way fal-generation.js reads. That module's
 * `catch { return []; }` turns an unreadable job file into an empty job list, which
 * silently frees every concurrency slot. The same shape here would mean "this
 * project has no media" — and a later index would then re-mint an assetId for every
 * file, destroying every relationship built on the old ones. So when the primary
 * AND the backup are both unreadable this store REFUSES. Losing a ledger loudly is
 * recoverable; losing identity silently is not.
 *
 * PHASE 2a: inert. Nothing in the product calls readLedger or writeLedger, and no
 * `media-assets.json` is created by opening a project. A missing sidecar is the
 * normal pre-Phase-2b state and reads as an empty ledger that does not exist yet.
 */

const fs = require("fs");
const path = require("path");

const {
  MEDIA_ASSETS_FILE,
  MEDIA_ASSETS_SCHEMA_VERSION,
  emptyLedger,
  validateLedger,
} = require("./media-assets");

function ledgerPath(projectDir) {
  return path.join(projectDir, MEDIA_ASSETS_FILE);
}
function backupPath(projectDir) {
  return `${ledgerPath(projectDir)}.bak`;
}

class LedgerUnreadableError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "LedgerUnreadableError";
    this.code = "LEDGER_UNREADABLE";
    this.detail = detail || {};
  }
}

function parseLedger(target) {
  /* A BOM is what PowerShell's Out-File and Notepad leave behind, and every other
     JSON reader in this repository tolerates one. */
  const parsed = JSON.parse(String(fs.readFileSync(target, "utf8")).replace(/^﻿/, ""));
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.assets))
    throw new Error("media-assets.json is not a ledger document.");
  return parsed;
}

/* Reads the ledger for a project.

   Returns { ledger, exists, recovered, warning, schemaVersion, readOnly }.

     missing            -> an empty ledger, exists:false. NORMAL, not an error.
     primary valid      -> the primary
     primary corrupt    -> the backup, recovered:true, with a warning
     both corrupt       -> THROWS LedgerUnreadableError
     unknown version    -> readOnly:true, serve what parsed, refuse writes    */
function readLedger(projectDir) {
  const target = ledgerPath(projectDir);
  const backup = backupPath(projectDir);

  let ledger = null;
  let recovered = false;
  let warning = "";
  let primaryError = null;

  try {
    ledger = parseLedger(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      /* No sidecar yet. This is the state every project is in before Phase 2b
         indexes it, and every reader must tolerate it. */
      return {
        ledger: emptyLedger(), exists: false, recovered: false,
        warning: "", schemaVersion: MEDIA_ASSETS_SCHEMA_VERSION, readOnly: false,
      };
    }
    primaryError = error;
    try {
      ledger = parseLedger(backup);
      recovered = true;
      warning = "media-assets.json was unreadable; CineBraid loaded its backup copy.";
    } catch (backupError) {
      /* Both gone. Refuse — do not invent an empty ledger. */
      throw new LedgerUnreadableError(
        "media-assets.json and its backup are both unreadable. CineBraid will not treat that as an empty media ledger, "
        + "because re-indexing would mint a new identity for every file and discard every relationship built on the old ones. "
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

  const version = Number(ledger.schemaVersion);
  const readOnly = version !== MEDIA_ASSETS_SCHEMA_VERSION;
  if (readOnly && !warning)
    warning = `media-assets.json declares schemaVersion ${ledger.schemaVersion}; this build understands `
      + `${MEDIA_ASSETS_SCHEMA_VERSION} and will read it without writing.`;

  return { ledger, exists: true, recovered, warning, schemaVersion: ledger.schemaVersion, readOnly };
}

/* One writer per project directory, chained. Two concurrent writes must not
   interleave a temp file or lose a row — the same discipline public/app.js uses for
   the project save. */
const writeChains = new Map();

function writeLedgerSync(projectDir, ledger) {
  const validated = validateLedger(ledger);
  if (!validated.ok) {
    const error = new Error(
      `Refusing to persist an invalid media ledger: ${validated.errors.map((e) => `${e.field} ${e.code}`).join(", ")}.`,
    );
    error.code = "LEDGER_INVALID";
    error.errors = validated.errors;
    throw error;
  }

  const target = ledgerPath(projectDir);
  const backup = backupPath(projectDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  /* Serialised so the JSON is byte-stable: writing the same ledger twice must
     produce an identical file, or "idempotent" means nothing on disk. */
  const payload = JSON.stringify(
    { schemaVersion: MEDIA_ASSETS_SCHEMA_VERSION, assets: ledger.assets },
    null,
    2,
  );
  JSON.parse(payload);

  const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    /* The backup is taken BEFORE the primary is replaced, so a crash between the
       two leaves a readable previous ledger rather than nothing. */
    if (fs.existsSync(target)) fs.copyFileSync(target, backup);
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

function writeLedger(projectDir, ledger) {
  const key = path.resolve(projectDir);
  const previous = writeChains.get(key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => writeLedgerSync(projectDir, ledger));
  writeChains.set(key, next.catch(() => {}));
  return next;
}

module.exports = {
  LedgerUnreadableError,
  backupPath,
  ledgerPath,
  readLedger,
  writeLedger,
  writeLedgerSync,
};

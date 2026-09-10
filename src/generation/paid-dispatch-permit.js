/* CineBraid — the PAID DISPATCH PERMIT.
 *
 * WHAT THIS EXISTS TO ANSWER, and it is exactly one question:
 *
 *     which authorization does this one paid dispatch belong to?
 *
 * It answers nothing else. It does not price anything, does not hold a ceiling, does not
 * build or copy a generation plan, and does not judge freshness. Those owners already
 * exist and stay where they are — public/shared-generation-rate.js prices,
 * automation-runs.json and entity.coverageAutomation hold the ceilings,
 * shared-generation-presentation.js owns the plan, shared-build-history.js owns freshness,
 * and dispatchGenerationRequest() remains the one money boundary. This adds a NOUN to that
 * boundary, not a second authority.
 *
 * WHY A NOUN WAS MISSING. Membership in a bounded authorization was, until this module, a
 * CLAIM the request made about itself: `automationRunId` on the body for a run, and a
 * comparison of `coverageMode`/`coverageSheetType` for coverage. Both are fields the work
 * being bounded writes for itself, so both could be omitted or restated. Measured on the
 * previous candidate: an automation run capped at one image dispatched a second paid job
 * by leaving `automationRunId` out, and a coverage run bounded to one request dispatched a
 * second by blanking `coverageMode` — which also REPLACED and erased the bounded run.
 * Neither is a matching bug; a matching rule over fields the caller supplies cannot be
 * made correct. Membership has to be established by the server and carried, which is what
 * a permit is.
 *
 * THE SHAPE. A permit is minted by a server path that has already established the
 * authorization from state the request cannot reach — a validated run lease, or a
 * validated coverage operation, or the direct issuance route standing in for a person
 * pressing Generate. The dispatch presents it. The boundary reads class and reference off
 * the PERMIT and ignores what the body says about either.
 *
 * SPENTNESS IS NOT STORED HERE. A permit is redeemed if and only if a row in
 * generation-jobs.json carries its id. That is deliberate: the ledger is the durable truth
 * about paid work, its write is atomic (temp-then-rename) and serialised per project by
 * fal-generation.js's commit(), and a second `redeemed: true` flag in THIS file could not
 * be written atomically with it. Two files, two writes, no transaction — the exact shape
 * the coverage-durability correction already removed from this repository. So this store
 * holds only unredeemed capabilities and removing one after redemption is housekeeping
 * that nothing depends on.
 *
 * The document on disk is a bare JSON array, with the same durability class as
 * generation-job-store.js: atomic temp-then-rename, a `.bak` taken before the primary is
 * replaced, read-side recovery from it, and a REFUSAL when both copies are unreadable. A
 * corrupt permit store is not an empty permit store: reading it as empty would refuse
 * every paid dispatch in flight, and — worse — would look exactly like a working
 * fail-closed system while the reason was a parse error nobody was told about.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PERMITS_FILE = "paid-permits.json";
/* The three authorizations CineBraid actually has. A permit's class is decided by the
   ISSUANCE PATH and never by a request field — that is the whole of what makes a run
   unable to reclassify itself as manual work by editing its own body. */
const PAID_PERMIT_CLASSES = ["automation", "coverage", "direct"];
/* Long enough that no legitimate press can lose a race with it — the runner revalidates
   and POSTs in the same tick, and a dialog's Generate handler does the same — and short
   enough that a capability left behind by an interrupted press stops being live. */
const PAID_PERMIT_TTL_MS = 10 * 60 * 1000;

function permitsPath(projectDir) {
  return path.join(projectDir, PERMITS_FILE);
}
function backupPath(projectDir) {
  return `${permitsPath(projectDir)}.bak`;
}

class PaidPermitStoreUnreadableError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "PaidPermitStoreUnreadableError";
    this.code = "PAID_PERMIT_STORE_UNREADABLE";
    this.status = 409;
    this.detail = detail || {};
  }
}

/* A BOM is what PowerShell's Out-File and Notepad leave behind, and every other JSON
   reader in this repository tolerates one. */
function parsePermits(target) {
  const parsed = JSON.parse(String(fs.readFileSync(target, "utf8")).replace(/^﻿/, ""));
  if (!Array.isArray(parsed)) throw new Error("paid-permits.json is not a permit array.");
  return parsed;
}

/* missing -> [], exists:false (NORMAL: a project that has never generated has no file)
   primary valid -> the primary
   primary corrupt -> the backup, recovered:true, with a warning
   both corrupt -> REFUSAL */
function readPaidPermits(projectDir) {
  const target = permitsPath(projectDir);
  const backup = backupPath(projectDir);
  let primaryError;
  try {
    return { permits: parsePermits(target), exists: true, recovered: false, warning: "" };
  } catch (error) {
    if (error?.code === "ENOENT") return { permits: [], exists: false, recovered: false, warning: "" };
    primaryError = error;
  }
  try {
    return {
      permits: parsePermits(backup),
      exists: true,
      recovered: true,
      warning: "paid-permits.json was unreadable; CineBraid loaded its backup copy.",
    };
  } catch (backupError) {
    throw new PaidPermitStoreUnreadableError(
      backupError?.code === "ENOENT"
        ? "CineBraid could not read the paid-dispatch permit store and it has no backup copy. It will not treat that as "
          + "\"no permits\", because that would refuse every generation already in flight while looking exactly like a "
          + "working refusal. No paid request was submitted."
        : "CineBraid could not read the paid-dispatch permit store or its backup. It will not treat that as \"no permits\". "
          + "No paid request was submitted.",
      {
        path: target,
        backupPath: backup,
        primary: String(primaryError?.message || primaryError),
        backup: backupError?.code === "ENOENT" ? "missing" : String(backupError?.message || backupError),
      },
    );
  }
}

function writePaidPermitsSync(projectDir, permits) {
  if (!Array.isArray(permits)) throw new Error("Refusing to persist a paid-permit store that is not an array.");
  const target = permitsPath(projectDir);
  const backup = backupPath(projectDir);
  fs.mkdirSync(projectDir, { recursive: true });

  const payload = JSON.stringify(permits, null, 2);
  JSON.parse(payload); // never rename a temp file we cannot read back

  const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (fs.existsSync(target)) {
      let primaryReadable = true;
      try { parsePermits(target); } catch { primaryReadable = false; }
      if (primaryReadable) fs.copyFileSync(target, backup);
    }
    fs.renameSync(temp, target);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    throw error;
  }
  return { path: target, bytes: Buffer.byteLength(payload, "utf8") };
}

/* ===========================================================================
   THE SCOPE FINGERPRINT — what a permit was minted FOR.
 *
 * A permit says which authorization a dispatch belongs to. It must not also become a way
 * to buy materially different paid work under an authorization granted for something else,
 * so the paid-relevant identity of the upcoming request is hashed at issuance and
 * recomputed from the gated request at redemption.
 *
 * EVERY FIELD HAS AN INVARIANT AND THERE ARE NO OTHERS:
 *   purpose, surface, viewMode  the canonical plan, BY REFERENCE. The plan itself is
 *                               rebuilt by generationRequestPlan() from the one shared
 *                               table; copying it here would be a second plan model.
 *   shotId/frameId/entityList/entityId   which production object the money buys.
 *   buildId                     which compiled package. The REQUEST's own value, not the
 *                               resolved one: freshness and the plan gate already own the
 *                               resolution, and fingerprinting a value the issuer cannot
 *                               see would refuse honest requests.
 *   outputCount                 the paid quantity. One image and four images are not the
 *                               same purchase.
 *   requestFingerprint          WHICH PROVIDER REQUEST, for a provider that prices one.
 *                               Empty for every backend that does not, which is every
 *                               backend that existed before Civitai — see below.
 *
 * DELIBERATELY ABSENT: model and capability. modelIdentityRefusal() and the control plan
 * already refuse a mismatch there, and a second owner of the same question is how two
 * owners come to disagree.
 *
 * WHY requestFingerprint EXISTS, AND WHY IT IS EMPTY ON THE FAL PATH.
 *
 * The eight fields above describe the PURCHASE — which production object, which package,
 * how many results. On the fal path that is the whole of the paid identity: the amount
 * comes from a rate an operator configured, the model is resolved server-side inside the
 * boundary, and there is no provider-supplied number for a caller to attach itself to.
 * Nothing provider-side can change between authorization and dispatch, so there is
 * nothing provider-side to bind, and this field stays "".
 *
 * A provider that QUOTES breaks that. Civitai prices one exact request body and returns a
 * Buzz figure for it; the same purchase identity — same shot, same frame, same build, same
 * count — covers a cheap request and an expensive one. A permit that bound only the eight
 * fields would let a quote obtained for request A authorize the submission of request B,
 * which is the "membership as a claim the request makes about itself" failure this module
 * was written to end, reappearing one layer out. So the adapter hashes the canonical bytes
 * it estimated and hands the digest in here, and the boundary recomputes it from the body
 * it is about to send.
 *
 * IT LIVES HERE RATHER THAN IN THE ADAPTER for the same reason spentness lives in the
 * ledger: the alternative is a second, adapter-owned store keyed by permit id, written
 * next to this one and not with it. Two files, two writes, no transaction — the exact
 * shape the coverage-durability correction already removed from this repository.
 *
 * Deterministic by construction: a fixed key order written out here rather than
 * Object.keys() on a caller-built object, so a caller cannot change the hash by changing
 * insertion order, and every value is normalised to a string except the count. A caller
 * that omits requestFingerprint gets "" and therefore the behaviour it had before the
 * field existed — the value is normalised by the same String(row[key] ?? "") rule as
 * every other member, so no existing issuance path had to learn about it. */
const SCOPE_FIELDS = ["purpose", "surface", "viewMode", "shotId", "frameId", "entityList", "entityId", "buildId", "requestFingerprint"];
function paidScopeFingerprint(scope) {
  const row = scope && typeof scope === "object" ? scope : {};
  const canonical = {};
  for (const key of SCOPE_FIELDS) canonical[key] = String(row[key] == null ? "" : row[key]);
  canonical.outputCount = Math.max(0, Math.round(Number(row.outputCount) || 0));
  return crypto.createHash("sha256").update(JSON.stringify(canonical, [...SCOPE_FIELDS, "outputCount"])).digest("hex");
}

/* ===========================================================================
   MINTING.

   `id` is 32 random bytes from crypto, not a timestamp and not a counter: the one thing a
   permit must be is unguessable by the code it governs, because a permit a caller can
   construct for itself is `automationRunId` again under a new name. */
function mintPaidPermit({ permitClass, authorizationRef = "", stepKey = "", scope = {}, at = new Date().toISOString(), ttlMs = PAID_PERMIT_TTL_MS } = {}) {
  if (!PAID_PERMIT_CLASSES.includes(permitClass)) throw new Error(`Unknown paid permit class: ${permitClass}`);
  const issuedAt = at;
  return {
    id: `permit-${crypto.randomBytes(16).toString("hex")}`,
    permitClass,
    authorizationRef: String(authorizationRef || ""),
    stepKey: String(stepKey || ""),
    scopeFingerprint: paidScopeFingerprint(scope),
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + Math.max(1000, Number(ttlMs) || PAID_PERMIT_TTL_MS)).toISOString(),
  };
}

function paidPermitExpired(permit, nowIso) {
  const expires = Date.parse(permit?.expiresAt || "");
  const at = Date.parse(nowIso || new Date().toISOString());
  return !Number.isFinite(expires) || !Number.isFinite(at) || expires <= at;
}

/* Issue and persist, dropping anything already expired on the way through. Reaping here
   rather than on a timer keeps the store small without a second scheduled owner, and it
   happens on the only path that ever grows the file. */
function issuePaidPermit(projectDir, options = {}) {
  const permit = mintPaidPermit(options);
  const { permits } = readPaidPermits(projectDir);
  const at = options.at || new Date().toISOString();
  const kept = permits.filter((row) => row && row.id && !paidPermitExpired(row, at));
  kept.push(permit);
  writePaidPermitsSync(projectDir, kept);
  return permit;
}

/* Look a presented permit up. Returns the permit or a typed reason — never a boolean,
   because "unknown" and "expired" are different things to tell a filmmaker and different
   things for a negative control to distinguish. */
function findPaidPermit(projectDir, permitId, nowIso) {
  const id = String(permitId || "").trim();
  if (!id) return { ok: false, reason: "missing" };
  const { permits } = readPaidPermits(projectDir);
  const permit = permits.find((row) => row && String(row.id) === id);
  if (!permit) return { ok: false, reason: "unknown" };
  if (paidPermitExpired(permit, nowIso)) return { ok: false, reason: "expired", permit };
  return { ok: true, permit };
}

/* Housekeeping only. Nothing about spentness depends on this succeeding: a permit is
   redeemed because a ledger row names it, and that row is written inside the ledger's own
   serialised turn. A crash between the two leaves a permit here that the boundary will
   refuse anyway, which is the safe direction. */
function dropPaidPermit(projectDir, permitId) {
  const id = String(permitId || "").trim();
  if (!id) return false;
  let permits;
  try { ({ permits } = readPaidPermits(projectDir)); } catch { return false; }
  const kept = permits.filter((row) => row && String(row.id) !== id);
  if (kept.length === permits.length) return false;
  try { writePaidPermitsSync(projectDir, kept); } catch { return false; }
  return true;
}

module.exports = {
  PERMITS_FILE,
  PAID_PERMIT_CLASSES,
  PAID_PERMIT_TTL_MS,
  PaidPermitStoreUnreadableError,
  backupPath,
  dropPaidPermit,
  findPaidPermit,
  issuePaidPermit,
  mintPaidPermit,
  paidPermitExpired,
  paidScopeFingerprint,
  permitsPath,
  readPaidPermits,
  writePaidPermitsSync,
};

/* CINEBRAID — THE PRODUCTION AUTHORITY KERNEL.
 *
 * Browser and Node, the same way public/shared-media-disposition.js is shared.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A KERNEL (Dogfood #2, Repair Batch 1C).
 *
 * Batch 1B introduced a durable authority receipt and routed the frame and
 * entity-state writers through one command. The independent re-audit accepted
 * that the honest path was now honest, and then walked around it six ways:
 *
 *   - the credential was a SHAPE. `{ actor: "human", act: "explicit-approval" }`
 *     is two strings any caller can type, and the public builder that produces
 *     them was exported to `window`. "Human" meant "somebody said human".
 *   - the reader validated almost nothing. A row with a blank id, sequence 0,
 *     `actor: "automation"`, and component fields naming a different frame was
 *     accepted as current human authority because its `targetId` string matched
 *     and its value matched the live edge.
 *   - two rows could both be `current`; the last one silently won. A ledger
 *     whose sequence had been reset minted a second `authority-000001`.
 *   - the write was not a transaction. `applyEdge` ran first; a non-extensible
 *     project root then made the ledger write a no-op, and the command returned
 *     a receipt id for a receipt that was never persisted.
 *   - whole classes of canonical pointer — video winners, coverage slots,
 *     expression slots, creation-final — were never in the model at all, while
 *     being consumed downstream as generation, continuity and export authority.
 *   - reconciliation completed a real gate against `receiptId:
 *     "not-a-real-receipt"`, because its only check was that the string was
 *     non-empty.
 *
 * Every one of those is the same mistake in a different place: TRUTH WAS BEING
 * DERIVED FROM THE SHAPE OF DATA A CALLER SUPPLIED. So the kernel owns three
 * things and nothing else owns any of them:
 *
 *     1. WHAT a production authority target IS         (canonical descriptor)
 *     2. WHETHER a durable ledger is TRUSTWORTHY       (full schema validation)
 *     3. HOW an authority change is COMMITTED          (one transaction)
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT, stated because the scope matters as much as the mechanism.
 *
 * CineBraid is a local, single-user application. This is NOT an authentication
 * system, NOT a cryptographic identity system, and NOT a defence against a
 * hostile operator of the machine. Building any of those here would be
 * disproportionate and would not make a filmmaker's project truer.
 *
 * The invariant that IS required:
 *
 *     AUTOMATION AND ORDINARY INTERNAL APPLICATION PATHS MUST NOT BE ABLE TO
 *     SYNTHESIZE HUMAN PRODUCTION AUTHORITY.
 *
 * That is met by making the credential an OBJECT IDENTITY held in a registry
 * private to this module, minted only inside a trusted user gesture, bound to
 * the exact targets it may authorize, and consumed once. A caller cannot
 * construct one by writing the right fields, because there are no right fields
 * — the kernel checks whether it minted this exact object. Automation runs in
 * async continuations, outside any gesture, so it cannot obtain one.
 *
 * Deliberately absent, and required to stay absent:
 *   - file or network I/O
 *   - provider or model awareness
 *   - Date.now(), new Date(), Math.random() other than through a supplied `at`
 *   - UI wording. The kinds and codes below are TOKENS. */

/* ========================================================================== */
/* VOCABULARY                                                                 */
/* ========================================================================== */

/* EVERY PRODUCTION OBJECT A HUMAN CAN HOLD AUTHORITY OVER.
 *
 * Batch 1B carried two. The re-audit's §9 is the argument for the rest: a
 * coverage slot is read by the generation reference builder, by server-side
 * entity review as "approved alternate-view design authority", by the
 * production-media projection as an `approved-coverage` disposition, and by OFP
 * export as an approved-output reference. Calling that "not a gate object,
 * therefore not authority" confused gate SCHEDULING with production TRUTH.
 *
 * A closed set. Adding a member is a contract change that has to be argued for,
 * which is the point of writing it down. */
const AUTHORITY_TARGET_KINDS = [
  "shot-frame",         /* the still approved for one frame; the opening frame's edge is also the shot's */
  "shot-motion",        /* the video approved for one motion unit */
  "shot-delivery",      /* the shot's final deliverable pointer */
  "entity-state",       /* a continuity state's approved reference */
];

/* FOUR, NOT SIX — AND THE TWO THAT ARE MISSING WERE REMOVED, NOT FORGOTTEN.
 *
 * The re-audit was right that coverage and expression slots were being consumed
 * as generation, continuity, export and implicit-human authority while carrying
 * no receipt. There were two ways to end that contradiction: extend the kernel
 * to cover them, or stop the consumers treating them as authority.
 *
 * ALPHA TAKES THE SECOND. A coverage slot is a useful supporting reference — a
 * three-quarter view a creator wants on hand — and nothing in the evidenced
 * workflow needs it to be canon. Making it non-authoritative removes a whole
 * authority surface instead of instrumenting one, which is a smaller and more
 * honest model. public/shared-entity-slots.js owns what they are now.
 *
 * Adding a kind back is a contract change that has to be argued for. That is
 * the point of the list being closed and short. */
const AUTHORITY_COMMANDS = [
  "approve-shot-frame",
  "approve-shot-motion",
  "approve-shot-delivery",
  "approve-entity-state",
];

const AUTHORITY_COMMAND_FOR_KIND = {
  "shot-frame": "approve-shot-frame",
  "shot-motion": "approve-shot-motion",
  "shot-delivery": "approve-shot-delivery",
  "entity-state": "approve-entity-state",
};

const AUTHORITY_RECEIPT_STATES = ["current", "superseded", "revoked"];
const AUTHORITY_REVOCATION_REASONS = ["replaced", "withdrawn", "target-cleared", "target-removed"];

/* The only actor and the only act. A list of one each, on purpose. */
const AUTHORITY_ACTOR = "human";
const AUTHORITY_ACT = "explicit-approval";

/* Where the ledger lives, and the shape version it is written at.
   1D-05: the version is VALIDATED, not decorative. A ledger written by a build
   this one does not understand is not something to read approvals out of or
   append to, so it fails closed like any other unreadable ledger. */
const AUTHORITY_LEDGER_KEY = "productionAuthority";
const AUTHORITY_LEDGER_VERSION = 1;

/* WHY A LEDGER OR A RECEIPT WAS REFUSED. Enumerated so a diagnostic surface can
   switch on a token and a repair tool can group by cause, rather than matching
   prose that will be reworded. */
const AUTHORITY_DIAGNOSTIC_CODES = [
  "ledger-not-an-object",
  "receipts-not-an-array",
  "receipt-not-an-object",
  "receipt-id-missing",
  "receipt-id-duplicated",
  "receipt-actor-not-human",
  "receipt-act-invalid",
  "receipt-command-invalid",
  "receipt-command-mismatched",
  "receipt-target-invalid",
  "receipt-target-key-mismatched",
  "receipt-value-missing",
  "receipt-status-invalid",
  "receipt-sequence-invalid",
  "receipt-sequence-duplicated",
  "receipt-provenance-missing",
  "target-multiple-current-receipts",
];

function kernelObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function kernelText(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}
function kernelList(value) {
  return Array.isArray(value) ? value : [];
}
function kernelInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function authorityError(code, message, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.authorityViolation = true;
  error.detail = kernelObject(detail);
  return error;
}

/* ========================================================================== */
/* 1. THE CANONICAL TARGET DESCRIPTOR                                         */
/* ========================================================================== */

/* ONE SHAPE FOR "WHICH PRODUCTION OBJECT", and one string that identifies it.
 *
 * The re-audit accepted a receipt whose `targetId` matched while its `shotId`
 * and `frameId` named something else — because the two were stored separately
 * and only one was compared. The key is DERIVED from the parts here, and
 * validation re-derives it, so the two can never disagree without being caught.
 *
 * Returns null rather than a partial descriptor. A half-identified target is
 * exactly what lets a receipt for one frame answer for another. */
function authorityTarget(details) {
  const it = kernelObject(details);
  /* `kind` is the field; `targetType` is accepted for the Batch 1B call sites
     that already speak it, so both vocabularies resolve to one descriptor. */
  const kind = kernelText(it.kind || it.targetType);
  const shotId = kernelText(it.shotId);
  const frameId = kernelText(it.frameId);
  const unitKey = kernelText(it.unitKey || it.segmentId || it.clipId);
  const list = kernelText(it.list || it.entityList);
  const entityId = kernelText(it.entityId);
  const stateId = kernelText(it.stateId);
  const slotId = kernelText(it.slotId);
  const base = { kind, shotId: "", frameId: "", unitKey: "", list: "", entityId: "", stateId: "", slotId: "" };
  if (kind === "shot-frame") {
    if (!shotId || !frameId) return null;
    return { ...base, shotId, frameId, key: `shot-frame:${shotId}#${frameId}` };
  }
  if (kind === "shot-motion") {
    if (!shotId || !unitKey) return null;
    return { ...base, shotId, unitKey, key: `shot-motion:${shotId}#${unitKey}` };
  }
  if (kind === "shot-delivery") {
    if (!shotId) return null;
    return { ...base, shotId, key: `shot-delivery:${shotId}` };
  }
  if (kind === "entity-state") {
    if (!list || !entityId || !stateId) return null;
    return { ...base, list, entityId, stateId, key: `entity-state:${list}:${entityId}#${stateId}` };
  }
  return null;
}

function sameAuthorityTarget(a, b) {
  const left = kernelObject(a);
  const right = kernelObject(b);
  return !!kernelText(left.key) && kernelText(left.key) === kernelText(right.key);
}

/* ========================================================================== */
/* 2. TRUSTED MANUAL ACTION PROVENANCE                                        */
/* ========================================================================== */

/* THE CREDENTIAL IS AN OBJECT IDENTITY, NOT A SHAPE.
 *
 * `MINTED` is private to this module and keyed by the token object itself. A
 * caller who constructs `{ actor: "human", act: "explicit-approval" }` — the
 * exact value the re-audit forged — holds an object this map has never seen,
 * and there is no field they can add that changes that. There is nothing to
 * guess because there is nothing being compared.
 *
 * A Map rather than a WeakSet: the token carries what it may authorize, and the
 * kernel needs to read that on consumption. Entries are removed when exhausted,
 * so the map does not grow. */
const MINTED_MANUAL_ACTIONS = new Map();

/* IS A REAL PERSON DOING SOMETHING RIGHT NOW.
 *
 * In the browser this is `event.isTrusted`, which the user agent sets and page
 * script cannot forge — the one primitive that distinguishes a human gesture
 * from a function call, available for free, with no login and no crypto. The
 * gesture window is open for the synchronous turn of the event dispatch, which
 * is exactly when an `onclick` handler's prologue runs.
 *
 * Automation lives in `await` continuations and timer callbacks. It is never
 * inside a trusted gesture, so it cannot mint. That is the whole separation,
 * and for a local single-user tool it is the proportionate amount of it. */
let TRUSTED_GESTURE = null;
let GESTURE_SEQUENCE = 0;
let MANUAL_ACTION_SEQUENCE = 0;

/* Composition installs this once. Absent — which is the state in a bare Node
   process — every mint FAILS CLOSED. A test harness installs its own gate and
   drives it explicitly; that is a seam in the composition, not a hole in the
   model, and `manualActionSourceInstalled()` reports which one is in force. */
let MANUAL_ACTION_SOURCE = "";

function openTrustedGesture(kind) {
  GESTURE_SEQUENCE += 1;
  TRUSTED_GESTURE = { id: `gesture-${GESTURE_SEQUENCE}`, kind: kernelText(kind) };
  return TRUSTED_GESTURE;
}
function closeTrustedGesture() {
  TRUSTED_GESTURE = null;
}
function trustedGestureOpen() {
  return !!TRUSTED_GESTURE;
}
function manualActionSourceInstalled() {
  return MANUAL_ACTION_SOURCE;
}

/* THE BROWSER INSTALLER. Capture phase, so it runs before any handler; a
   macrotask closes the window, so the gesture covers the synchronous prologue
   of the handler and nothing that resumes later. */
/* 1D-01 — INSTALL ONCE, AND ONLY FROM THE COMPOSITION THAT BOOTS THE PAGE.
 *
 * bootstrap.js calls this before load(). Any later call is refused, so page
 * script cannot install a second source on an event target it controls and
 * then fire its own events at it. There is exactly one source per process and
 * the first caller — the composition root — decides what it is. */
function installBrowserManualActionSource(target, schedule) {
  if (MANUAL_ACTION_SOURCE) return false;
  const root = target || (typeof document !== "undefined" ? document : null);
  if (!root || typeof root.addEventListener !== "function") return false;
  const later = typeof schedule === "function" ? schedule : (fn) => setTimeout(fn, 0);
  for (const type of ["click", "keydown", "change", "submit"]) {
    root.addEventListener(type, (event) => {
      if (!event || event.isTrusted !== true) return;
      openTrustedGesture(type);
      later(closeTrustedGesture);
    }, true);
  }
  MANUAL_ACTION_SOURCE = "browser-trusted-event";
  return true;
}

/* THERE IS NO SYNTHETIC GESTURE SOURCE. Batch 1C shipped one — an exported
 * `installHarnessManualActionSource` that opened the window with no event at
 * all — and the 1C acceptance audit used it from ordinary browser code to mint
 * `actor: "human"`. A test-only door in a shipped module is a door.
 *
 * There is now exactly one way to open the gesture window: a trusted event
 * delivered by a user agent to the event target the composition root installed
 * on. Tests drive that same path from OUTSIDE the page scope — see
 * tests/authority-test-gesture.js — because the test composition owns the DOM
 * double and page script does not. */

/* MINT. Called at the top of an explicit manual approval handler, synchronously,
   while the gesture is still open.
 *
 * `targets` binds the token to exactly what it may authorize — a batch approval
 * of four slots mints one token for those four and nothing else. Each target is
 * consumable once, so a token cannot be replayed, and a token for slot A cannot
 * approve slot B.
 *
 * 1D-02 — AND TO THE EXACT DECISION. A target alone was not enough: the 1C
 * audit minted a capability while the modal displayed value A / asset-A and
 * committed value B / asset-B against the same target. A capability now means
 *
 *     THIS gesture, approving THIS target, with THESE bytes.
 *
 * A target entry may carry `value` and `assetId`. When it does, the commit must
 * present the same ones or it is refused as stale. A bare target (no value) is
 * still accepted for the callers that genuinely cannot know the filename until
 * after an await — a rename, say — but every creator-facing approval binds the
 * value, and tests/dogfood2-p0-architecture.js pins which ones. */
function beginManualAuthorityAction(details = {}) {
  const it = kernelObject(details);
  if (!TRUSTED_GESTURE) {
    throw authorityError(
      "MANUAL_ACTION_REQUIRED",
      "Production authority may only be established by an explicit human approval action. No authority was written.",
      { source: MANUAL_ACTION_SOURCE || "none" },
    );
  }
  /* Each entry keeps its own declared value/asset, so one batch token can bind
     four different files to four different targets. A top-level `value` /
     `assetId` is the single-target shorthand. */
  const entries = [];
  for (const raw of kernelList(it.targets)) {
    const target = authorityTarget(raw);
    if (!target) continue;
    const row = kernelObject(raw);
    entries.push({
      key: target.key,
      value: kernelText(row.value) || kernelText(it.value),
      assetId: kernelText(row.assetId) || kernelText(it.assetId),
    });
  }
  if (!entries.length) {
    throw authorityError(
      "MANUAL_ACTION_TARGET_REQUIRED",
      "An approval action must name at least one complete production target. No authority was written.",
    );
  }
  MANUAL_ACTION_SEQUENCE += 1;
  const token = { manualAction: `manual-${MANUAL_ACTION_SEQUENCE}` };
  MINTED_MANUAL_ACTIONS.set(token, {
    via: kernelText(it.via) || "unspecified-manual-surface",
    gestureId: TRUSTED_GESTURE.id,
    gestureKind: TRUSTED_GESTURE.kind,
    remaining: new Map(entries.map((entry) => [entry.key, entry])),
  });
  return token;
}

/* READ-ONLY: may this token authorize this target. Used by a caller that wants
   to check before doing expensive work; consumption still happens in the
   command. */
function manualActionCovers(token, target) {
  const record = MINTED_MANUAL_ACTIONS.get(token);
  const wanted = authorityTarget(target);
  return !!record && !!wanted && record.remaining.has(wanted.key);
}

/* CONSUME. Private to the transaction below — a caller cannot spend a token
   without also committing through the kernel, which is what stops "mint, spend,
   write nothing" and "mint once, write twice". */
function consumeManualAction(token, target, value, assetId) {
  const record = MINTED_MANUAL_ACTIONS.get(token);
  if (!record) {
    throw authorityError(
      "MANUAL_ACTION_INVALID",
      "This approval was not issued by an explicit human action. No authority was written.",
    );
  }
  const wanted = authorityTarget(target);
  if (!wanted || !record.remaining.has(wanted.key)) {
    throw authorityError(
      "MANUAL_ACTION_TARGET_MISMATCH",
      "This approval action does not cover the object being approved. No authority was written.",
      { expected: [...record.remaining.keys()], received: wanted ? wanted.key : "" },
    );
  }
  /* 1D-02 — THE DECISION, NOT JUST THE TARGET. If the gesture named the bytes,
     the commit must present the same bytes. A selection that changed after the
     capability was minted is STALE and is refused; it is never silently
     approved instead. */
  const bound = record.remaining.get(wanted.key);
  const wantedValue = kernelText(value);
  const wantedAsset = kernelText(assetId);
  if (bound.value && bound.value !== wantedValue) {
    throw authorityError(
      "MANUAL_ACTION_VALUE_STALE",
      "The selection changed after you confirmed it, so CineBraid did not approve the new one. Choose again and confirm. No authority was written.",
      { expected: bound.value, received: wantedValue },
    );
  }
  if (bound.assetId && bound.assetId !== wantedAsset) {
    throw authorityError(
      "MANUAL_ACTION_ASSET_STALE",
      "The image changed after you confirmed it, so CineBraid did not approve the new one. Choose again and confirm. No authority was written.",
      { expected: bound.assetId, received: wantedAsset },
    );
  }
  /* And the reverse: a capability minted against a specific asset may not be
     spent on a request that has forgotten the identity. */
  if (bound.assetId && !wantedAsset) {
    throw authorityError(
      "MANUAL_ACTION_ASSET_STALE",
      "The approval no longer identifies the exact image it was confirmed for. Choose again and confirm. No authority was written.",
      { expected: bound.assetId, received: "" },
    );
  }
  record.remaining.delete(wanted.key);
  if (!record.remaining.size) MINTED_MANUAL_ACTIONS.delete(token);
  return { via: record.via, gestureId: record.gestureId, gestureKind: record.gestureKind };
}

/* ========================================================================== */
/* 3. LEDGER VALIDATION — the whole schema, at every read                     */
/* ========================================================================== */

/* ONE RECEIPT, CHECKED COMPLETELY.
 *
 * The re-audit's §3.2 list is this function's specification: id, actor, act,
 * command, command/kind agreement, canonical target, target-key agreement with
 * the component fields, value, status, sequence, and the provenance marker that
 * says a trusted manual action issued it. */
function validateReceiptShape(row, index) {
  const problems = [];
  const receipt = kernelObject(row);
  const at = { index, id: kernelText(receipt.id) };
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { ok: false, receipt: null, problems: [{ code: "receipt-not-an-object", ...at }] };
  }
  if (!kernelText(receipt.id)) problems.push({ code: "receipt-id-missing", ...at });
  if (kernelText(receipt.actor) !== AUTHORITY_ACTOR) problems.push({ code: "receipt-actor-not-human", ...at, actor: kernelText(receipt.actor) });
  if (kernelText(receipt.act) !== AUTHORITY_ACT) problems.push({ code: "receipt-act-invalid", ...at, act: kernelText(receipt.act) });
  const command = kernelText(receipt.command);
  if (!AUTHORITY_COMMANDS.includes(command)) problems.push({ code: "receipt-command-invalid", ...at, command });
  const target = authorityTarget(receipt);
  if (!target) problems.push({ code: "receipt-target-invalid", ...at, kind: kernelText(receipt.kind || receipt.targetType) });
  else {
    /* THE KEY IS RE-DERIVED FROM THE PARTS. A stored key that disagrees with the
       fields beside it is the forgery the re-audit walked in through. */
    if (kernelText(receipt.targetKey) && kernelText(receipt.targetKey) !== target.key) {
      problems.push({ code: "receipt-target-key-mismatched", ...at, stored: kernelText(receipt.targetKey), derived: target.key });
    }
    if (AUTHORITY_COMMAND_FOR_KIND[target.kind] !== command && AUTHORITY_COMMANDS.includes(command)) {
      problems.push({ code: "receipt-command-mismatched", ...at, command, kind: target.kind });
    }
  }
  if (!kernelText(receipt.value)) problems.push({ code: "receipt-value-missing", ...at });
  if (!AUTHORITY_RECEIPT_STATES.includes(kernelText(receipt.status))) problems.push({ code: "receipt-status-invalid", ...at, status: kernelText(receipt.status) });
  const sequence = kernelInteger(receipt.sequence);
  if (sequence === null || sequence < 1) problems.push({ code: "receipt-sequence-invalid", ...at, sequence: receipt.sequence });
  /* THE MARKER A TRUSTED MANUAL ACTION LEAVES. Not a credential — the token was
     the credential and it was consumed at commit — but a receipt that does not
     carry it was not written by this kernel, and the kernel will not vouch for
     it. */
  if (!kernelText(kernelObject(receipt.provenance).manualAction)) problems.push({ code: "receipt-provenance-missing", ...at });
  return { ok: !problems.length, receipt: problems.length ? null : { ...receipt, target }, problems };
}

/* THE WHOLE LEDGER, AND THE CROSS-ROW RULES no single row can enforce:
   unique ids, unique sequences, and EXACTLY ONE CURRENT RECEIPT PER TARGET.
 *
 * FAILS CLOSED AND DOES NOT REPAIR. A malformed ledger yields `trusted: false`
 * and a diagnostic list; every authority question then answers "no". Silently
 * dropping the bad rows and carrying on would be the same class of mistake as
 * inferring authority from a pointer: it invents an answer where the project
 * does not have one. */
function validateAuthorityLedger(project) {
  const raw = kernelObject(project)[AUTHORITY_LEDGER_KEY];
  const diagnostics = [];
  if (raw === undefined || raw === null) {
    /* NO LEDGER IS NOT A MALFORMED LEDGER. It is a project in which nobody has
       approved anything yet — every pre-1B project, and the honest answer for
       every legacy pointer in it. */
    return { present: false, trusted: true, version: AUTHORITY_LEDGER_VERSION, receipts: [], byTarget: new Map(), diagnostics };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({ code: "ledger-not-an-object" });
    return { present: true, trusted: false, version: 0, receipts: [], byTarget: new Map(), diagnostics };
  }
  const ledger = kernelObject(raw);
  if (ledger.receipts !== undefined && !Array.isArray(ledger.receipts)) {
    diagnostics.push({ code: "receipts-not-an-array" });
    return { present: true, trusted: false, version: kernelInteger(ledger.version) || 0, receipts: [], byTarget: new Map(), diagnostics };
  }
  const declaredVersion = kernelInteger(ledger.version) || 0;
  if (declaredVersion > AUTHORITY_LEDGER_VERSION || declaredVersion < 1) {
    diagnostics.push({
      code: "AUTHORITY_LEDGER_VERSION_UNSUPPORTED",
      message: `This project's approval records are written at version ${JSON.stringify(ledger.version)}, which this build of CineBraid does not read. No approval is recognised.`,
      version: ledger.version,
      supported: AUTHORITY_LEDGER_VERSION,
    });
    return { present: true, trusted: false, version: declaredVersion, receipts: [], byTarget: new Map(), diagnostics };
  }
  const rows = kernelList(ledger.receipts);
  const receipts = [];
  const seenIds = new Set();
  const seenSequences = new Set();
  for (let index = 0; index < rows.length; index++) {
    const outcome = validateReceiptShape(rows[index], index);
    diagnostics.push(...outcome.problems);
    if (!outcome.ok) continue;
    const id = kernelText(outcome.receipt.id);
    if (seenIds.has(id)) { diagnostics.push({ code: "receipt-id-duplicated", index, id }); continue; }
    seenIds.add(id);
    const sequence = kernelInteger(outcome.receipt.sequence);
    if (seenSequences.has(sequence)) { diagnostics.push({ code: "receipt-sequence-duplicated", index, id, sequence }); continue; }
    seenSequences.add(sequence);
    receipts.push(outcome.receipt);
  }
  /* Exactly one current per target. Two is not "the newest wins" — it is a
     ledger nobody can read, and reading it anyway is how the re-audit got a
     silent winner. */
  const byTarget = new Map();
  for (const receipt of receipts) {
    const key = receipt.target.key;
    const bucket = byTarget.get(key) || { key, all: [], current: [] };
    bucket.all.push(receipt);
    if (kernelText(receipt.status) === "current") bucket.current.push(receipt);
    byTarget.set(key, bucket);
  }
  for (const bucket of byTarget.values()) {
    if (bucket.current.length > 1) {
      diagnostics.push({ code: "target-multiple-current-receipts", targetKey: bucket.key, ids: bucket.current.map((row) => kernelText(row.id)) });
    }
  }
  return {
    present: true,
    trusted: diagnostics.length === 0,
    version: kernelInteger(ledger.version) || 0,
    receipts,
    byTarget,
    diagnostics,
  };
}

/* The diagnostic a surface prints when a project's authority cannot be read.
   Deterministic ordering, so the same damage produces the same message. */
function authorityLedgerDiagnostics(project) {
  const view = validateAuthorityLedger(project);
  return view.diagnostics
    .map((row) => ({ ...row }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : (Number(a.index) || 0) - (Number(b.index) || 0)));
}

/* ========================================================================== */
/* 4. READING AUTHORITY                                                       */
/* ========================================================================== */

/* WHAT THE PROJECT CURRENTLY SAYS is approved for this target — the live edge,
   read without interpretation. Supplied by the host module, which knows the
   document shape; the kernel knows only that an edge has a value and maybe an
   asset id. */
let EDGE_READER = null;
function installAuthorityEdgeReader(reader) {
  EDGE_READER = typeof reader === "function" ? reader : null;
  return EDGE_READER;
}
function liveAuthorityEdge(project, target) {
  const wanted = authorityTarget(target);
  if (!wanted || !EDGE_READER) return { value: "", assetId: "" };
  const edge = kernelObject(EDGE_READER(project, wanted));
  return { value: kernelText(edge.value), assetId: kernelText(edge.assetId) };
}

/* IS THERE CURRENT HUMAN AUTHORITY over this object.
 *
 * Four conditions, and every one of them is a counterexample the re-audit
 * reproduced when it was missing:
 *
 *   the LEDGER is trustworthy   — a malformed ledger answers "no" for
 *                                 everything, rather than for nothing
 *   exactly ONE current receipt — two current rows is unreadable, not "latest"
 *   the receipt is VALID        — full schema, checked in validateAuthorityLedger
 *   the EDGE still matches      — a writer that cleared the pointer without
 *                                 revoking still loses authority. FAIL CLOSED.
 *
 * Returns the receipt, never a boolean, because every caller that matters wants
 * to cite it. */
function currentHumanAuthority(project, target) {
  const wanted = authorityTarget(target);
  if (!wanted) return null;
  const view = validateAuthorityLedger(project);
  if (!view.trusted) return null;
  const bucket = view.byTarget.get(wanted.key);
  if (!bucket || bucket.current.length !== 1) return null;
  const receipt = bucket.current[0];
  const live = liveAuthorityEdge(project, wanted);
  if (!live.value) return null;
  /* 1D-05 — AGREEMENT, NOT EITHER-OR.
   *
   * This was `byName || byIdentity`, and the 1C audit showed what that buys: a
   * receipt whose assetId had been changed to name different bytes stayed
   * current because the filename still matched. One contradictory field is a
   * contradiction; it is not a half-match to be rounded up.
   *
   * THE RULE, and there is only one: the filename must match exactly, and
   * where BOTH sides carry an asset identity that must match exactly too. A
   * side that has no identity recorded is not a contradiction — plenty of
   * legitimate edges predate identity stamping — but two identities that
   * disagree are.
   *
   * A legitimate rename does not need this to be loose: repairAuthorityValue()
   * is the explicit operation that moves an approval to a new filename and
   * keeps the receipt true. */
  if (live.value !== kernelText(receipt.value)) return null;
  const receiptAsset = kernelText(receipt.assetId);
  const liveAsset = kernelText(live.assetId);
  if (receiptAsset && liveAsset && receiptAsset !== liveAsset) return null;
  return receipt;
}

function hasCurrentHumanAuthority(project, target) {
  return !!currentHumanAuthority(project, target);
}

/* Every receipt for one target, oldest first — history, including superseded
   and revoked rows. Only from a trustworthy ledger. */
function authorityHistory(project, target) {
  const wanted = authorityTarget(target);
  if (!wanted) return [];
  const view = validateAuthorityLedger(project);
  if (!view.trusted) return [];
  return (view.byTarget.get(wanted.key) || { all: [] }).all.slice();
}

/* A POINTER NOBODY APPROVED. Not an error and not hidden: it is a real
   selection somebody's machine made, and the product shows it as a
   recommendation a person can accept in one act. */
function historicSelection(project, target) {
  const wanted = authorityTarget(target);
  if (!wanted) return null;
  const live = liveAuthorityEdge(project, wanted);
  if (!live.value) return null;
  if (currentHumanAuthority(project, wanted)) return null;
  const view = validateAuthorityLedger(project);
  const bucket = view.byTarget.get(wanted.key);
  const revoked = bucket ? bucket.all.filter((row) => kernelText(row.status) !== "current") : [];
  return {
    ...wanted,
    value: live.value,
    assetId: live.assetId,
    basis: !view.trusted ? "authority-ledger-unreadable" : revoked.length ? "authority-revoked" : "no-human-receipt",
    priorReceiptCount: revoked.length,
    requiresHumanApproval: true,
  };
}

/* ========================================================================== */
/* 5. THE TRANSACTION                                                         */
/* ========================================================================== */

/* THE HOST SUPPLIES PERSISTENCE. The kernel stages a complete draft document
   and hands it over in one call; whether that is an in-memory assignment or a
   file write is not its business. Default is a same-document apply, which is
   what the browser needs. */
let PROJECT_COMMITTER = null;
function installAuthorityProjectCommitter(committer) {
  PROJECT_COMMITTER = typeof committer === "function" ? committer : null;
  return PROJECT_COMMITTER;
}

/* Structured-clone the parts a transaction may touch. `structuredClone` when
   the runtime has it; a JSON round trip otherwise. Both are total for project
   documents, which are JSON by construction. */
function draftOf(project) {
  const source = kernelObject(project);
  if (typeof structuredClone === "function") return structuredClone(source);
  return JSON.parse(JSON.stringify(source));
}

/* Copy the draft's committed state back onto the live document, IN PLACE.
 *
 * WHY THIS IS A DEEP MERGE AND NOT AN ASSIGNMENT, learned the hard way: the
 * first version did `project[key] = draft[key]`, which replaces `project.shots`
 * with the draft's cloned array. Every reference a caller was already holding —
 * `const s = shotById(id)`, `const c = ensureShotCreation(s)` — then pointed at
 * a detached object, and its later writes went nowhere. A motion approval
 * reopened on a frame change stopped reopening, because the code clearing it
 * was writing to an orphan.
 *
 * Object identity is preserved wherever the shape matches: same array, same
 * element objects, same nested records. A commit becomes invisible to anything
 * holding a reference, which is the property a browser page needs and the one
 * an in-place mutation model has always assumed. */
function mergeInPlace(live, next) {
  if (Array.isArray(live) && Array.isArray(next)) {
    for (let index = 0; index < next.length; index++) {
      const value = next[index];
      if (index < live.length && live[index] && value && typeof live[index] === "object" && typeof value === "object"
        && Array.isArray(live[index]) === Array.isArray(value)) {
        mergeInPlace(live[index], value);
      } else {
        live[index] = value;
      }
    }
    live.length = next.length;
    return live;
  }
  for (const key of Object.keys(live)) if (!(key in next)) delete live[key];
  for (const key of Object.keys(next)) {
    const value = next[key];
    const existing = live[key];
    if (existing && value && typeof existing === "object" && typeof value === "object" && Array.isArray(existing) === Array.isArray(value)) {
      mergeInPlace(existing, value);
    } else {
      live[key] = value;
    }
  }
  return live;
}
function applyDraftToProject(project, draft) {
  if (typeof PROJECT_COMMITTER === "function") return PROJECT_COMMITTER(project, draft);
  return mergeInPlace(project, draft);
}

/* THE ONE COMMAND. Every production-authority change in CineBraid comes through
   here.
 *
 * THE ORDER IS THE GUARANTEE, and the re-audit's §3.3 is what happens without
 * it: `applyEdge` ran first, the ledger write silently failed against a
 * non-extensible root, and the command returned a receipt id for a receipt that
 * did not exist. So:
 *
 *   1. resolve the target                      — nothing touched
 *   2. consume the manual action               — nothing touched
 *   3. eligibility veto (ownership)            — nothing touched
 *   4. DRAFT the document
 *   5. apply the edge to the DRAFT
 *   6. supersede + append the receipt on the DRAFT
 *   7. VALIDATE the draft's whole ledger, and the edge/receipt correspondence
 *   8. commit the draft in one write
 *
 * A failure at any step leaves the live document untouched, because until step
 * 8 nothing has been written to it. The manual action is consumed at step 2 and
 * that is deliberate: a refused approval burns the gesture rather than leaving
 * a live token a retry loop could spend. */
function commitAuthorityTransaction(project, request = {}) {
  const it = kernelObject(request);
  const target = authorityTarget(it);
  if (!target) {
    throw authorityError("AUTHORITY_TARGET_INCOMPLETE", "A production-authority command must name a complete target. No authority was written.");
  }
  const what = describeTarget(target);
  /* THE CREDENTIAL. Identity, not shape. */
  const value = kernelText(it.value);
  const assetId = kernelText(it.assetId);
  if (!value) {
    throw authorityError("AUTHORITY_VALUE_REQUIRED", `${what} cannot be approved without naming the media being approved. No authority was written.`);
  }
  /* THE CREDENTIAL. Identity, not shape — and bound to these exact bytes. */
  const provenance = consumeManualAction(it.manualAction, target, value, assetId);
  /* STEP 3 — the target kind's own mandatory policy. Not a parameter. */
  enforceTargetPolicy(project, target, value);
  /* A ledger that is already unreadable is not something to append to. */
  const before = validateAuthorityLedger(project);
  if (!before.trusted) {
    throw authorityError(
      "AUTHORITY_LEDGER_UNREADABLE",
      `This project's approval records cannot be read, so CineBraid will not add to them. No authority was written. (${before.diagnostics.map((row) => row.code).join(", ")})`,
      { diagnostics: before.diagnostics },
    );
  }
  const draft = draftOf(project);
  /* STEP 5 — the edge, written by the kernel's own installed writer onto the
     draft. No caller code runs inside this transaction at all, so there is no
     closure to reason about and no convention for a caller to forget. */
  if (typeof AUTHORITY_EDGE_WRITER !== "function") {
    throw authorityError(
      "AUTHORITY_EDGE_WRITER_MISSING",
      "CineBraid cannot record approvals because its authority edge writer is not installed. No authority was written.",
    );
  }
  const wrote = AUTHORITY_EDGE_WRITER(draft, target, { value, assetId, at: kernelText(it.at) });
  if (wrote === false) {
    throw authorityError(
      "AUTHORITY_TARGET_UNAVAILABLE",
      `${what} is not in this project, so there is nothing to approve. No authority was written.`,
    );
  }
  /* STEP 6 — supersession and the new receipt, on the draft. */
  const ledger = draft[AUTHORITY_LEDGER_KEY] && typeof draft[AUTHORITY_LEDGER_KEY] === "object" && !Array.isArray(draft[AUTHORITY_LEDGER_KEY])
    ? draft[AUTHORITY_LEDGER_KEY]
    : {};
  ledger.version = kernelInteger(ledger.version) || AUTHORITY_LEDGER_VERSION;
  ledger.receipts = kernelList(ledger.receipts);
  const at = kernelText(it.at);
  for (const row of ledger.receipts) {
    const existing = kernelObject(row);
    const existingTarget = authorityTarget(existing);
    if (!existingTarget || existingTarget.key !== target.key || kernelText(existing.status) !== "current") continue;
    existing.status = "superseded";
    existing.supersededAt = at;
    existing.revocationReason = "replaced";
  }
  /* SEQUENCE AND ID ARE ALLOCATED AGAINST WHAT IS DURABLY THERE, not against a
     counter the document carries. A ledger whose `sequence` field had been
     reset minted a second `authority-000001`; deriving it from the maximum
     sequence actually present cannot. */
  const highest = ledger.receipts.reduce((max, row) => Math.max(max, kernelInteger(kernelObject(row).sequence) || 0), 0);
  const sequence = highest + 1;
  const usedIds = new Set(ledger.receipts.map((row) => kernelText(kernelObject(row).id)));
  let id = `authority-${String(sequence).padStart(6, "0")}`;
  let suffix = 1;
  while (usedIds.has(id)) { id = `authority-${String(sequence).padStart(6, "0")}-${++suffix}`; }
  const receipt = {
    id,
    sequence,
    actor: AUTHORITY_ACTOR,
    act: AUTHORITY_ACT,
    command: AUTHORITY_COMMAND_FOR_KIND[target.kind],
    kind: target.kind,
    targetKey: target.key,
    shotId: target.shotId,
    frameId: target.frameId,
    unitKey: target.unitKey,
    list: target.list,
    entityId: target.entityId,
    stateId: target.stateId,
    slotId: target.slotId,
    value,
    assetId,
    at,
    status: "current",
    supersededBy: "",
    supersededAt: "",
    revokedAt: "",
    revocationReason: "",
    note: kernelText(it.note),
    /* WHICH manual action issued this, and from which surface. */
    provenance: { manualAction: kernelText(provenance.gestureId) || "manual-action", via: kernelText(provenance.via), gesture: kernelText(provenance.gestureKind) },
  };
  for (const row of ledger.receipts) {
    const existing = kernelObject(row);
    if (kernelText(existing.status) === "superseded" && !kernelText(existing.supersededBy) && authorityTarget(existing)?.key === target.key) existing.supersededBy = id;
  }
  ledger.receipts.push(receipt);
  draft[AUTHORITY_LEDGER_KEY] = ledger;
  /* STEP 7 — the draft must be readable, and the edge it just wrote must be the
     one the receipt describes. This is what makes the returned receipt a
     statement about durable state rather than about an intention. */
  const after = validateAuthorityLedger(draft);
  if (!after.trusted) {
    throw authorityError(
      "AUTHORITY_TRANSACTION_INVALID",
      `${what} could not be approved: the resulting approval records would not be readable. Nothing was changed. (${after.diagnostics.map((row) => row.code).join(", ")})`,
      { diagnostics: after.diagnostics },
    );
  }
  if (!currentHumanAuthority(draft, target)) {
    throw authorityError(
      "AUTHORITY_EDGE_NOT_WRITTEN",
      `${what} could not be approved: the approval record and the project would not agree. Nothing was changed.`,
      { expected: value, observed: liveAuthorityEdge(draft, target).value },
    );
  }
  /* STEP 8 — one write, AND PROOF THAT IT LANDED.
   *
   * The re-audit's non-extensible-root case survives everything above: the draft
   * is a clone and therefore extensible, so it validates perfectly, and only the
   * copy back into the live document fails — silently, because a refused
   * property add on a non-extensible object is a no-op outside strict mode. The
   * command would return a receipt id for a ledger the project does not have.
   *
   * So the live document is re-read after the write and asked the same question
   * the caller is about to believe the answer to. If the answer is no, the
   * pre-image goes back and the caller gets an exception instead of a lie. */
  const preImage = draftOf(project);
  applyDraftToProject(project, draft);
  if (!currentHumanAuthority(project, target)) {
    applyDraftToProject(project, preImage);
    throw authorityError(
      "AUTHORITY_NOT_PERSISTED",
      `${what} could not be approved: the change could not be written to this project. Nothing was changed.`,
      { targetKey: target.key },
    );
  }
  return receipt;
}

/* WITHDRAWING AUTHORITY, on the same terms and through the same draft. */
function revokeAuthorityTransaction(project, request = {}) {
  const it = kernelObject(request);
  const target = authorityTarget(it);
  if (!target) throw authorityError("AUTHORITY_TARGET_INCOMPLETE", "A revocation must name a complete target. Nothing was changed.");
  const reason = AUTHORITY_REVOCATION_REASONS.includes(kernelText(it.reason)) ? kernelText(it.reason) : "withdrawn";
  const at = kernelText(it.at);
  const draft = draftOf(project);
  /* 1D-07 — THE KERNEL CLEARS THE EDGE TOO. A revocation used to take the same
     caller `applyEdge` the commit did, with the same closure problem. Clearing
     is the one write that is exactly the inverse of establishing, so the same
     installed writer does it, with an empty value. */
  if (it.clearEdge !== false && typeof AUTHORITY_EDGE_WRITER === "function") {
    AUTHORITY_EDGE_WRITER(draft, target, { value: "", assetId: "", at });
  }
  const ledger = kernelObject(draft[AUTHORITY_LEDGER_KEY]);
  const revoked = [];
  for (const row of kernelList(ledger.receipts)) {
    const receipt = kernelObject(row);
    if (authorityTarget(receipt)?.key !== target.key || kernelText(receipt.status) !== "current") continue;
    receipt.status = "revoked";
    receipt.revokedAt = at;
    receipt.revocationReason = reason;
    receipt.revokedVia = kernelText(it.via);
    revoked.push(receipt.id);
  }
  applyDraftToProject(project, draft);
  return revoked;
}

/* A rename moved the bytes and the edge followed; the receipt has to follow or
   the next read revokes a decision a person really made. Same transaction. */
function repairAuthorityValue(project, change = {}) {
  const it = kernelObject(change);
  const from = kernelText(it.from);
  const to = kernelText(it.to);
  const assetId = kernelText(it.assetId);
  if (!from || !to || from === to) return [];
  const draft = draftOf(project);
  const ledger = kernelObject(draft[AUTHORITY_LEDGER_KEY]);
  const repaired = [];
  for (const row of kernelList(ledger.receipts)) {
    const receipt = kernelObject(row);
    if (kernelText(receipt.value) !== from) continue;
    receipt.value = to;
    if (assetId) receipt.assetId = assetId;
    repaired.push(kernelText(receipt.id));
  }
  if (repaired.length) applyDraftToProject(project, draft);
  return repaired;
}

function describeTarget(target) {
  const it = kernelObject(target);
  if (it.kind === "shot-frame") return `Frame ${it.frameId} of ${it.shotId}`;
  if (it.kind === "shot-motion") return `Motion ${it.unitKey} of ${it.shotId}`;
  if (it.kind === "shot-delivery") return `The final deliverable for ${it.shotId}`;
  if (it.kind === "entity-state") return `${it.list} ${it.entityId} state ${it.stateId}`;
  return "This edge";
}

/* 1D-03 — MANDATORY TARGET POLICY, OWNED BY THE KERNEL.
 *
 * Batch 1C asked the caller for an `eligibility` callback and ran it only "if
 * function". The 1C audit passed `eligibility: () => ({ok:true})` and
 * established Canon for a file two entities both claim. A rule a caller can
 * decline to supply is not a rule.
 *
 * The policy is now a property of the TARGET KIND and lives here. There is no
 * parameter for it, so there is nothing to omit and nothing to replace.
 *
 *   entity-state   the file must have exactly one durable owner, and it must be
 *                  the entity being approved. Zero owners, an inferred/prefix
 *                  match, or two claimants all refuse.
 *   shot-*         no ownership concept — a shot's own take belongs to the shot.
 *
 * The resolver is installed once by shared-entity-ownership.js via
 * useEntityOwnershipResolver(); it is a module wiring, not a per-call argument.
 */
let OWNERSHIP_POLICY = null;
function installAuthorityOwnershipPolicy(policy) {
  OWNERSHIP_POLICY = typeof policy === "function" ? policy : null;
  return !!OWNERSHIP_POLICY;
}
function enforceTargetPolicy(project, target, value) {
  if (target.kind !== "entity-state") return;
  if (typeof OWNERSHIP_POLICY !== "function") {
    throw authorityError(
      "AUTHORITY_OWNERSHIP_UNAVAILABLE",
      "CineBraid cannot check which reference owns this image, so it will not record an approval it cannot justify. No authority was written.",
    );
  }
  const verdict = kernelObject(OWNERSHIP_POLICY(project, target, value));
  if (verdict.ok === true) return;
  throw authorityError(
    kernelText(verdict.code) || "AUTHORITY_OWNERSHIP_INELIGIBLE",
    kernelText(verdict.message) || `${describeTarget(target)} cannot be approved for this image.`,
  );
}

/* 1D-07 — THE EDGE WRITER IS INSTALLED, NOT PASSED.
 *
 * Batch 1C took an `applyEdge(draft)` callback from every caller and claimed a
 * caller "physically cannot reach the live document" from inside it. That was
 * false — a closure reaches whatever it closed over — and the 1C audit proved
 * it by mutating the live project from a callback that then threw.
 *
 * So callers no longer supply one. `shared-production-authority.js` installs a
 * single writer at module load which knows how to write all four target kinds,
 * exactly mirroring the reader installed beside it. A caller passes the target
 * and the bytes; the kernel decides what that means on disk.
 *
 * What this deletes: twelve caller-authored edge callbacks, the `eligibility`
 * parameter, and `draftReadOnly` — a function whose whole job was to pretend a
 * live object was a snapshot. */
let AUTHORITY_EDGE_WRITER = null;
function installAuthorityEdgeWriter(writer) {
  AUTHORITY_EDGE_WRITER = typeof writer === "function" ? writer : null;
  return !!AUTHORITY_EDGE_WRITER;
}

const AUTHORITY_KERNEL_EXPORTS = {
  AUTHORITY_TARGET_KINDS,
  AUTHORITY_COMMANDS,
  AUTHORITY_COMMAND_FOR_KIND,
  AUTHORITY_RECEIPT_STATES,
  AUTHORITY_REVOCATION_REASONS,
  AUTHORITY_ACTOR,
  AUTHORITY_ACT,
  AUTHORITY_LEDGER_KEY,
  AUTHORITY_LEDGER_VERSION,
  AUTHORITY_DIAGNOSTIC_CODES,
  authorityError,
  authorityTarget,
  sameAuthorityTarget,
  describeTarget,
  /* manual action provenance */
  installBrowserManualActionSource,
  manualActionSourceInstalled,
  trustedGestureOpen,
  beginManualAuthorityAction,
  manualActionCovers,
  /* ledger validation */
  validateReceiptShape,
  validateAuthorityLedger,
  authorityLedgerDiagnostics,
  /* reading */
  installAuthorityEdgeReader,
  liveAuthorityEdge,
  currentHumanAuthority,
  hasCurrentHumanAuthority,
  authorityHistory,
  historicSelection,
  /* writing */
  installAuthorityEdgeWriter,
  installAuthorityOwnershipPolicy,
  installAuthorityProjectCommitter,
  commitAuthorityTransaction,
  revokeAuthorityTransaction,
  repairAuthorityValue,
};

/* A NAMESPACE, NOT LOOSE GLOBALS — and this is not tidiness.
 *
 * Every public/*.js shares one lexical scope in the browser. Exporting the
 * kernel's names individually meant `shared-production-authority.js`, which
 * defines its own `currentHumanAuthority` and `authorityTarget` as thin
 * wrappers, SHADOWED the kernel functions those wrappers call — and each
 * wrapper called itself until the stack ran out. The whole product blanked, and
 * no Node suite could see it because Node has no shared scope.
 *
 * The kernel is reached through one object nothing else is named. Only the
 * installers are also exposed loosely, because bootstrap.js and the test
 * harnesses call them by name and nothing redefines them. */
if (typeof window !== "undefined") {
  window.CineBraidAuthorityKernel = AUTHORITY_KERNEL_EXPORTS;
  for (const key of ["installBrowserManualActionSource", "manualActionSourceInstalled", "trustedGestureOpen"]) {
    window[key] = AUTHORITY_KERNEL_EXPORTS[key];
  }
}
if (typeof module !== "undefined" && module.exports) module.exports = AUTHORITY_KERNEL_EXPORTS;
